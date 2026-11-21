# Stage 7 intelligence and sustainability demo

Open **Sustainability** after signing in. **My farm** shows the signed-in grower’s records. **Organization** includes outgoing and incoming requests for a current membership. **Platform** gives administrators aggregate analytics and model monitoring.

1. In **Marketplace**, set up two verified recipient organizations with approved public locations, accepted crops, capacity in kg, and recipient pickup or farm drop-off. For sale offers, enable **Accepts sale offers**. For cold-chain listings, enable **Has cold storage** for eligible recipients.
2. Publish a farm listing in kilograms or pounds with more produce than one recipient can accept. Publishing or editing queues a plan. Open **Recommendations** under **Your listings** to see ranking factors, a multi-recipient allocation, and the estimated drop-off loop. Use **Recalculate** after quantities or profiles change. Recipients can request their suggested quantities through the existing marketplace workflow.
3. Complete a marketplace request. The dashboard shows recorded redistributed weight, separately recorded boxes, fulfillment rates for donations and sales, pending recipient demand, and distribution by approved public recipient site. The waste estimate assumes 50% of redistributed weight would otherwise have gone to waste. It is a demo scenario with no measured disposal counterfactual. The fulfillment denominator is all submitted requests for the selected scope.
4. Run a crop surplus scenario and a recipient demand forecast. Enter crop symptoms with an optional JPEG, PNG, or WebP leaf photo. Crop issue output can abstain. Similar labeled examples are retrieved from descriptions, and the displayed scores are uncalibrated hypotheses. A qualified expert can verify a diagnosis.
5. In **Farmer collaboration**, choose **Find similar farmers** on an issue report. Crop, category, interests, optional approximate public location, and latent text similarity contribute to the score. The author can message a matched farmer through the existing conversation flow.

## Planning and service design

The recommendation engine filters for compatible crops, seller and recipient availability, capacity, transport radius, cold storage and sale preferences, harvest shelf life, and the optional listing pickup window. It subtracts accepted open reservations from recipient capacity. Use **Pickup availability** and operating-hours notes for arrangements that require confirmation. If no service radius is specified the demo uses 100 km. Box listings need a known weight before the engine can allocate them against kg capacity.

SciPy/HiGHS first maximizes allocated quantity to reduce potential waste, then uses weighted rank, estimated fulfillment, and a distance penalty to choose the recipients and quantities. A nearest-neighbor loop improved with 2-opt orders up to eight drop-offs and checks arrival against the tightest deadline. The bounded search considers the top 40 ranked recipients. Distances use public coordinates, a road multiplier, and an assumed speed. Plans and estimated fulfillment are advisory and the marketplace remains responsible for reservations.

NestJS validates the user and membership, writes durable PostgreSQL jobs, and exposes `/api/v1/intelligence` routes for dashboards, jobs, forecasts, classification, recommendations, and matching. The FastAPI worker uses a leased PostgreSQL queue with reclaim after interruption. Completed jobs retain the version, result, and numeric monitoring signals. Inputs including uploaded photos are cleared at terminal status. FastAPI exposes `/v1/models` and `/v1/drift` to the NestJS integration. Configure the same `ML_SERVICE_KEY` in both services to authenticate those endpoints. Compose binds the ML service’s published port to loopback.

## Training data and evaluation

| Model or proxy      | Training and holdout                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Crop surplus        | U.S. apples, grapes, peaches, and pears. USDA total minus utilized production is a proxy for unutilized crop, expressed per bearing acre. Prior harvest and surplus, acreage change, and separate spring and summer NOAA weather averages are inputs. The latest 36 crop-years had **124.3 kg/acre MAE** versus **56.7** for persistence. The displayed interval targeted 80% coverage and covered **63.9%** on the held-out years. Farm scaling is a scenario and has no farm-level validation. |
| Public demand proxy | U.S. annual fresh domestic availability for apples, grapes, and pears. The selected persistence baseline had **73.4 million kg MAE** and **88.9%** interval coverage over 27 held-out crop-years. The target describes national availability.                                                                                                                                                                                                                                                    |
| CropCircle demand   | Optional monthly model trained on real recipient requests, prior acceptance, and distribution history. The stock demo uses the public proxy because it has no eligible local training history.                                                                                                                                                                                                                                                                                                   |
| Symptoms            | TF-IDF and logistic regression on broad extension-derived disease, pest, and nutrient labels. Conditions, with their names removed from the symptom text where present, were held out as groups. **0.90 macro F1** on 256 labeled descriptions. Field reports have no comparable validation.                                                                                                                                                                                                     |
| Leaf photos         | Color and edge descriptors with a small random forest using Digital Green expert annotations. Crops were held out as groups. **0.25 macro F1** on 75 photos. Photo output is experimental, lightly weighted alongside text, and cannot produce a standalone hypothesis.                                                                                                                                                                                                                          |
| Farmer similarity   | TF-IDF and truncated SVD produce document similarities, combined with structured and geographic features. The nearest labeled symptom example agreed on the broad category for **85.9%** of held-out descriptions. This is a retrieval proxy. Farmer-match quality has no outcome labels.                                                                                                                                                                                                        |

The commodity and weather snapshots come from the [USDA ERS Fruit and Tree Nuts Yearbook Tables](https://www.ers.usda.gov/data-products/fruit-and-tree-nuts-data/fruit-and-tree-nuts-yearbook-tables) and [NOAA Climate at a Glance](https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/). Symptom descriptions are adapted from [crop-disease-qa](https://huggingface.co/datasets/ixrbhii/crop-disease-qa) under CC BY 4.0. Leaf descriptors and broad labels are adapted from [Digital Green Farmer.Chat expert crop annotations](https://huggingface.co/datasets/kirutheen/Crop_Disease_Images) under CC BY 4.0. The photo snapshot stores numeric descriptors and annotation labels without distributing the original images.

## Run and verify

The demo was verified on November 21, 2026 with the Compose stack, the PostgreSQL-backed API integration test, and a browser pass covering all three dashboard scopes, marketplace recommendations, both forecasts, a leaf photo upload, farmer matching, and the mobile layout.

Compose builds a baseline model bundle from the checked-in data in a separate training image stage. The serving process loads the bundle without training in the request path. With the stack up, run the end-to-end test using a disposable local PostgreSQL database. The test populates fictional accounts and records for inspection.

```sh
pnpm db:migrate:deploy
pnpm --filter @cropcircle/api test:stage7:integration
pnpm typecheck
pnpm build
```

For independent training, evaluation, and FastAPI development from `apps/ml-service`:

```sh
python -m pip install -e ".[train,dev]"
python -m cropcircle_ml.train --data data --out models
python -m pytest
python -m uvicorn cropcircle_ml.main:app --port 8000
```

Use `ML_MODEL_DIR` to point inference to a different bundle. MLflow writes the local experiment under `models/mlruns` by default. Set `MLFLOW_TRACKING_URI` to direct training to a different tracking store. The manifest identifies the dataset and code version, MLflow run, holdout metrics, and active artifact. Drift compares recent logged inputs with feature reference ranges, reports insufficient samples below ten predictions, and flags shifts for review. Drift does not measure forecast error without outcomes.

With enough real marketplace history, export completed monthly aggregates and include them in training. The export drops organization identifiers and uses conservative, observable request outcomes for acceptance. Keep this local export out of version control.

```sh
python -m cropcircle_ml.export_demand --out demand-history.csv
python -m cropcircle_ml.train --data data --out models --platform-demand demand-history.csv
```
