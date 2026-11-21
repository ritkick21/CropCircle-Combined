/** Stable operational contract shared by the web app, API, and tooling. */
export type ServiceStatus = 'ok' | 'degraded' | 'unavailable';

export interface HealthResponse {
  service: 'web' | 'api' | 'ml-service';
  status: 'ok';
  timestamp: string;
}

export interface DependencyHealth {
  status: ServiceStatus;
  detail?: string;
}

export interface ReadinessResponse {
  service: 'web' | 'api' | 'ml-service';
  status: ServiceStatus;
  timestamp: string;
  dependencies: Record<string, DependencyHealth>;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  requestId?: string;
}

export interface RealtimeEventEnvelope<TData = unknown> {
  eventId: string;
  schemaVersion: 1;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  data: TData;
}

export type ResourceCategory =
  | 'FOOD_BANK'
  | 'COMMUNITY_FOOD'
  | 'FOSTER_SUPPORT'
  | 'FARMER'
  | 'FARMERS_MARKET'
  | 'GROCERY_RESTAURANT'
  | 'WHOLESALER'
  | 'RESEARCH_CENTER'
  | 'EXTENSION_SERVICE'
  | 'SPECIALIST';

export interface ResourceMarker {
  id: string;
  name: string;
  category: ResourceCategory;
  lng: number;
  lat: number;
  available: boolean;
}

export interface ResourceDetail extends ResourceMarker {
  organizationId: string;
  organizationName: string;
  description: string | null;
  addressLabel: string | null;
  acceptedCrops: string[];
  capacityKg: number | null;
  hours: Record<string, string> | null;
  distanceMeters: number | null;
}
export * from './realtime.js';

export * from './farmline.js';
