"""Issue hypotheses and farmer similarity. No output constitutes a diagnosis."""

from math import exp

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from cropcircle_ml.allocation import crop_key, distance
from cropcircle_ml.vision import image_features


def classify(models, crop, symptoms, photo=None):
    vectorizer = models["text_vectorizer"]
    tokens = set(vectorizer.build_analyzer()(symptoms))
    covered = len(tokens.intersection(vectorizer.vocabulary_))
    query = vectorizer.transform([symptoms])
    text = models["text_model"]
    text_scores = text.predict_proba(query)[0]
    scores = {str(label): float(score) for label, score in zip(text.classes_, text_scores)}
    image_scores = None
    if photo is not None:
        image = models["image_model"]
        confidence = image.predict_proba([image_features(photo)])[0]
        image_scores = {str(label): float(score) for label, score in zip(image.classes_, confidence)}
        if covered < 3:
            scores = image_scores
        else:
            scores = {label: 0.9 * scores.get(label, 0) + 0.1 * image_scores.get(label, 0)
                      for label in scores.keys() | image_scores.keys()}
    ordered = sorted(scores, key=lambda key: (-scores[key], key))
    top = scores[ordered[0]]
    weak = covered < 3 or top < 0.50
    examples = []
    if not weak:
        similarities = cosine_similarity(query, models["issue_reference_vectors"])[0]
        seen = set()
        for index in np.argsort(-similarities):
            label_crop, category, condition = models["issue_references"][index]
            if similarities[index] < 0.16:
                break
            if crop_key(crop) == label_crop and category == ordered[0] and condition not in seen:
                seen.add(condition)
                examples.append({"condition": condition, "similarity": round(float(similarities[index]), 3)})
                if len(examples) >= 2:
                    break
    return {
        "crop": crop,
        "assessment": "INSUFFICIENT_EVIDENCE" if weak else "AI_HYPOTHESIS",
        "photoAnalyzed": photo is not None,
        "photoSignal": max(image_scores, key=image_scores.get) if image_scores else None,
        "similarLabeledExamples": examples,
        "hypotheses": [] if weak else [{"category": label, "score": round(scores[label], 3)}
                                       for label in ordered[:3]],
        "scoreType": "Uncalibrated model score",
        "cropInTraining": crop_key(crop) in models["issue_crops"],
    }, {"top_score": top, "known_terms": float(covered)}


def similar(models, issue, candidates):
    if not candidates:
        return []
    documents = [item["symptoms"] for item in [issue, *candidates]]
    vectors = models["text_vectorizer"].transform(documents)
    latent = models["semantic"].transform(vectors)
    semantic = 0.6 * cosine_similarity(latent[:1], latent[1:])[0] + 0.4 * cosine_similarity(
        vectors[:1], vectors[1:]
    )[0]
    matches = []
    for candidate, relevance in zip(candidates, semantic):
        structured = float(crop_key(issue["crop_type"]) == crop_key(candidate["crop_type"]))
        category = issue["category"] == candidate["category"]
        overlap = sorted(set(issue["interests"]) & set(candidate["interests"]))
        km = distance(issue["point"], candidate["point"]) if issue["point"] and candidate["point"] else None
        nearby = exp(-km / 100) if km is not None else 0
        text_match = float(np.clip(relevance, 0, 1))
        score = 0.53 * text_match + 0.22 * structured + 0.12 * category + 0.08 * nearby + 0.05 * bool(overlap)
        if score >= 0.27:
            matches.append({
                "farmer": {"id": str(candidate["author_id"]), "displayName": candidate["display_name"]},
                "reportId": str(candidate["id"]), "cropType": candidate["crop_type"], "category": candidate["category"],
                "region": candidate["region"], "distanceKm": round(km, 1) if km is not None else None,
                "sharedInterests": overlap, "score": round(score, 3), "textSimilarity": round(text_match, 3),
            })
    by_farmer = {}
    for match in sorted(matches, key=lambda row: (-row["score"], row["reportId"])):
        by_farmer.setdefault(match["farmer"]["id"], match)
    return list(by_farmer.values())[:12]
