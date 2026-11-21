#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function aws(...args) {
  const output = execFileSync('aws', [...args, '--output', 'json', '--no-cli-pager'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: 900_000,
  });
  return output ? JSON.parse(output) : undefined;
}

function required(name) {
  const value = process.env[name];
  assert.ok(value, `Set ${name}`);
  return value;
}

function definition(stack, imageTag, smtp, migration = false) {
  const secrets = (names) => Object.entries(names).map(([name, field]) => ({
    name, valueFrom: `${stack.ApplicationSecret}:${field}::`,
  }));
  const environment = (values) => Object.entries(values).map(([name, value]) => ({ name, value }));
  const container = (name, repository, port, values, secretFields, check) => ({
    name,
    image: `${repository}:${imageTag}`,
    essential: true,
    environment: environment(values),
    secrets: secrets(secretFields),
    stopTimeout: 45,
    ...(port && { portMappings: [{ containerPort: port, protocol: 'tcp' }] }),
    ...(check && { healthCheck: { command: ['CMD-SHELL', check], interval: 20, timeout: 6, retries: 3, startPeriod: 45 } }),
    logConfiguration: {
      logDriver: 'awslogs',
      options: { 'awslogs-region': process.env.AWS_REGION, 'awslogs-group': stack.Logs, 'awslogs-stream-prefix': name },
    },
  });
  const nodeProbe = (port, path) => `node -e "fetch('http://127.0.0.1:${port}${path}',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"`;
  const api = container('api', stack.ApiRepository, 3001, {
    NODE_ENV: 'production', PORT: '3001', WEB_ORIGIN: `https://${stack.Domain}`,
    TRUST_PROXY: '1', AUTH_SMTP_HOST: smtp.host, AUTH_SMTP_PORT: smtp.port,
    AUTH_MAIL_FROM: smtp.from, REALTIME_PREFIX: `cropcircle-${stack.Environment}`,
    ML_SERVICE_URL: 'http://127.0.0.1:8000', S3_BUCKET: stack.MediaBucket,
    S3_REGION: process.env.AWS_REGION,
  }, {
    DATABASE_URL: 'api_database_url', REDIS_URL: 'redis_url', AUTH_JWT_SECRET: 'jwt_secret',
    ML_SERVICE_KEY: 'ml_service_key', AUTH_SMTP_USER: 'smtp_user', AUTH_SMTP_PASSWORD: 'smtp_password',
  }, nodeProbe(3001, '/api/v1/health/ready'));
  const ml = container('ml', stack.MlRepository, undefined, {
    NODE_ENV: 'production', ML_SERVICE_HOST: '127.0.0.1', ML_SERVICE_PORT: '8000',
    PGSSLROOTCERT: '/etc/ssl/certs/rds-global-bundle.pem',
  }, {
    DATABASE_URL: 'ml_database_url', REDIS_URL: 'redis_url', ML_SERVICE_KEY: 'ml_service_key',
  }, "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=4)\"");
  const web = container('web', stack.WebRepository, 3000, {
    NODE_ENV: 'production', PORT: '3000', HOSTNAME: '0.0.0.0',
    API_INTERNAL_URL: 'http://127.0.0.1:3001/api/v1',
  }, {}, nodeProbe(3000, '/api/health'));
  const migrate = {
    ...container('migrate', stack.ApiRepository, undefined, {}, { DATABASE_URL: 'migration_database_url' }),
    command: ['node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  };
  return {
    family: `cropcircle-${stack.Environment}${migration ? '-migrate' : ''}`,
    requiresCompatibilities: ['FARGATE'],
    networkMode: 'awsvpc',
    cpu: migration ? '512' : '2048',
    memory: migration ? '1024' : '4096',
    runtimePlatform: { cpuArchitecture: 'X86_64', operatingSystemFamily: 'LINUX' },
    executionRoleArn: stack.ExecutionRole,
    ...(migration ? {} : { taskRoleArn: stack.TaskRole }),
    containerDefinitions: migration ? [migrate] : [web, api, ml],
  };
}

async function deploy() {
  required('AWS_REGION');
  const stackName = required('AWS_STACK_NAME');
  const imageTag = required('IMAGE_TAG');
  assert.match(imageTag, /^[\w.-]{1,128}$/);
  const smtp = { host: required('SMTP_HOST'), port: required('SMTP_PORT'), from: required('MAIL_FROM') };
  const outputs = aws('cloudformation', 'describe-stacks', '--stack-name', stackName).Stacks[0].Outputs;
  const stack = Object.fromEntries(outputs.map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]));
  assert.match(stack.Environment, /^(staging|production)$/);

  const cluster = ['--cluster', stack.Cluster];
  const name = `cropcircle-${stack.Environment}`;
  const network = JSON.stringify({ awsvpcConfiguration: {
    subnets: stack.PrivateSubnetIds.split(','),
    securityGroups: [stack.TaskSecurityGroup],
    assignPublicIp: 'DISABLED',
  } });
  const register = (migration) => aws('ecs', 'register-task-definition', '--cli-input-json',
    JSON.stringify(definition(stack, imageTag, smtp, migration))).taskDefinition.taskDefinitionArn;

  const migration = register(true);
  const run = aws('ecs', 'run-task', ...cluster, '--launch-type', 'FARGATE',
    '--task-definition', migration, '--network-configuration', network);
  assert.equal(run.failures.length, 0, 'Migration task could not be placed');
  const migrationTask = run.tasks[0].taskArn;
  aws('ecs', 'wait', 'tasks-stopped', ...cluster, '--tasks', migrationTask);
  const task = aws('ecs', 'describe-tasks', ...cluster, '--tasks', migrationTask).tasks[0];
  assert.equal(task.containers.find((item) => item.name === 'migrate')?.exitCode, 0,
    'Database migration failed. Review the migrate stream in CloudWatch.');

  const previous = aws('ecs', 'describe-services', ...cluster, '--services', name)
    .services.find((service) => service.status === 'ACTIVE');
  const revision = register(false);
  const serviceArgs = ['--task-definition', revision];
  const desired = stack.Environment === 'production' ? '2' : '1';
  if (previous) {
    aws('ecs', 'update-service', ...cluster, '--service', name, ...serviceArgs, '--desired-count', desired);
  } else {
    aws('ecs', 'create-service', ...cluster, '--service-name', name, ...serviceArgs,
      '--network-configuration', network, '--launch-type', 'FARGATE', '--desired-count', desired,
      '--health-check-grace-period-seconds', '90',
      '--deployment-configuration', 'deploymentCircuitBreaker={enable=true,rollback=true},maximumPercent=200,minimumHealthyPercent=100',
      '--load-balancers', JSON.stringify([
        { containerName: 'api', containerPort: 3001, targetGroupArn: stack.ApiTarget },
        { containerName: 'web', containerPort: 3000, targetGroupArn: stack.WebTarget },
      ]));
  }
  const wait = () => aws('ecs', 'wait', 'services-stable', ...cluster, '--services', name);
  try {
    wait();
    const live = aws('ecs', 'describe-services', ...cluster, '--services', name).services[0];
    assert.equal(live.taskDefinition, revision, 'ECS rolled back the requested revision');
    for (const path of ['/api/health', '/api/dependencies', '/api/v1/health/ready']) {
      const res = await fetch(`https://${stack.Domain}${path}`, { signal: AbortSignal.timeout(10_000) });
      assert.equal(res.status, 200, path);
      assert.equal((await res.json()).status, 'ok', path);
    }
    const endpoint = `wss://${stack.Domain}/realtime/?EIO=4&transport=websocket`;
    execFileSync(process.execPath, ['infra/scripts/socket-smoke.mjs'], {
      env: { ...process.env, SOCKET_URL: endpoint, SOCKET_ACCESS_TOKEN: '' },
      stdio: 'inherit',
      timeout: 10_000,
    });
    console.log(`Verified HTTPS readiness for ${name} at revision ${revision}`);
  } catch (error) {
    if (previous) {
      console.error('Release checks failed. Restoring the prior ECS revision.');
      aws('ecs', 'update-service', ...cluster, '--service', name, '--task-definition', previous.taskDefinition);
      wait();
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await deploy();
}

export { definition };
