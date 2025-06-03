import asyncio
from autoreq.requirements_manager import RequirementsManager
from autoreq.test_generation.requirement_decomposition import decompose_requirements


async def predict_decomposed(rm, **kwargs):
    x = {req_id: rm.get_description(req_id) for req_id in rm.requirement_ids}

    decomposed = await decompose_requirements(list(x.values()), **kwargs)
    decomposed_req_map = {
        req_id: reqs for req_id, reqs in zip(rm.requirement_ids, decomposed)
    }

    labels = []
    decomposed_reqs = {}
    for req_id, reqs in decomposed_req_map.items():
        labels.append(True if len(reqs) > 1 else False)
        if len(reqs) > 1:
            decomposed_reqs[req_id] = reqs

    print(20 * '-')
    print('Decomposed requirements:')
    for req_id, reqs in decomposed_reqs.items():
        print(f'Requirement ID: {req_id}')
        for i, req in enumerate(reqs):
            print(f'  Decomposed Requirement {i + 1}: {req}')

    return labels


async def evaluate_decomposition_single(rm, true_labels, **kwargs):
    predicted_labels = await predict_decomposed(rm, **kwargs)

    confusion_matrix = {
        'TP': 0,
        'TN': 0,
        'FP': 0,
        'FN': 0,
    }

    assert len(true_labels) == len(predicted_labels), (
        'Length of true and predicted labels must match'
    )

    for true, pred in zip(true_labels, predicted_labels):
        if true and pred:
            confusion_matrix['TP'] += 1
        elif not true and not pred:
            confusion_matrix['TN'] += 1
        elif not true and pred:
            confusion_matrix['FP'] += 1
        elif true and not pred:
            confusion_matrix['FN'] += 1

    precision = (
        confusion_matrix['TP'] / (confusion_matrix['TP'] + confusion_matrix['FP'])
        if (confusion_matrix['TP'] + confusion_matrix['FP']) > 0
        else 0
    )
    recall = (
        confusion_matrix['TP'] / (confusion_matrix['TP'] + confusion_matrix['FN'])
        if (confusion_matrix['TP'] + confusion_matrix['FN']) > 0
        else 0
    )
    f1_score = (
        2 * (precision * recall) / (precision + recall)
        if (precision + recall) > 0
        else 0
    )
    accuracy = (confusion_matrix['TP'] + confusion_matrix['TN']) / sum(
        confusion_matrix.values()
    )

    return {
        'confusion_matrix': confusion_matrix,
        'precision': precision,
        'recall': recall,
        'f1_score': f1_score,
        'accuracy': accuracy,
    }


async def evaluate_decomposition(rm, true_labels, iter=10, **kwargs):
    # Create results in parallel
    results = await asyncio.gather(
        *[evaluate_decomposition_single(rm, true_labels, **kwargs) for _ in range(iter)]
    )

    # Aggregate results (and calculate stddev+confidence intervals)
    _aggregated_results = {
        'precision': sum(result['precision'] for result in results) / iter,
        'recall': sum(result['recall'] for result in results) / iter,
        'f1_score': sum(result['f1_score'] for result in results) / iter,
        'accuracy': sum(result['accuracy'] for result in results) / iter,
    }
    aggregated_results = {}

    # Calculate standard deviation for each metric
    for key, mean in _aggregated_results.items():
        variance = sum((result[key] - mean) ** 2 for result in results) / iter
        stddev = variance**0.5
        confidence_interval = 1.96 * (stddev / (iter**0.5))
        aggregated_results[key] = {
            'mean': mean,
            'stddev': stddev,
            'confidence_interval': confidence_interval,
        }

    return aggregated_results


def main(requirements_file, true_labels_file, **kwargs):
    rm = RequirementsManager(requirements_file)

    true_labels = [bool(int(label)) for label in open(true_labels_file).readlines()]

    results = asyncio.run(evaluate_decomposition(rm, true_labels, **kwargs))

    print('Evaluation Results:')
    for metric, values in results.items():
        print(f'{metric}: {values["mean"]} ± {values["confidence_interval"]}')


def cli():
    import argparse

    parser = argparse.ArgumentParser(description='Evaluate requirement decomposition.')
    parser.add_argument(
        'requirements_file', type=str, help='Path to the requirements file.'
    )
    parser.add_argument(
        'true_labels_file', type=str, help='Path to the true labels file.'
    )
    parser.add_argument(
        '--iter', type=int, default=10, help='Number of iterations for evaluation.'
    )
    parser.add_argument(
        '--k', type=int, default=1, help='Number of parallel decompositions.'
    )
    parser.add_argument(
        '--threshold_frequency',
        type=float,
        default=0.5,
        help='Threshold frequency for averaging sets.',
    )
    parser.add_argument(
        '--individual',
        action='store_true',
        help='Use individual decomposition instead of batched.',
    )
    args = parser.parse_args()

    main(
        args.requirements_file,
        args.true_labels_file,
        iter=args.iter,
        k=args.k,
        threshold_frequency=args.threshold_frequency,
        individual=args.individual,
    )


if __name__ == '__main__':
    cli()
