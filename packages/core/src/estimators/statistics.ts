export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sampleVariance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

export function invertMatrix(matrix: readonly (readonly number[])[]): number[][] {
  const size = matrix.length;
  if (size === 0 || matrix.some((row) => row.length !== size)) throw new Error('Matrix must be non-empty and square');
  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    ...Array.from({ length: size }, (_, columnIndex) => (rowIndex === columnIndex ? 1 : 0)),
  ]);

  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]?.[pivot] ?? 0) > Math.abs(augmented[best]?.[pivot] ?? 0)) best = row;
    }
    const pivotValue = augmented[best]?.[pivot] ?? 0;
    if (Math.abs(pivotValue) < 1e-12) throw new Error('Matrix is singular');
    const current = augmented[pivot];
    const replacement = augmented[best];
    if (!current || !replacement) throw new Error('Invalid matrix row');
    augmented[pivot] = replacement;
    augmented[best] = current;
    const normalized = augmented[pivot];
    if (!normalized) throw new Error('Invalid pivot row');
    for (let column = 0; column < size * 2; column += 1) normalized[column] = (normalized[column] ?? 0) / pivotValue;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const target = augmented[row];
      if (!target) continue;
      const factor = target[pivot] ?? 0;
      for (let column = 0; column < size * 2; column += 1) target[column] = (target[column] ?? 0) - factor * (normalized[column] ?? 0);
    }
  }
  return augmented.map((row) => row.slice(size));
}

export function multiplyMatrix(left: readonly (readonly number[])[], right: readonly (readonly number[])[]): number[][] {
  if (left.length === 0 || right.length === 0) return [];
  const inner = left[0]?.length ?? 0;
  if (right.length !== inner) throw new Error('Matrix dimensions do not align');
  const columns = right[0]?.length ?? 0;
  return left.map((row) => Array.from({ length: columns }, (_, column) => row.reduce((sum, value, index) => sum + value * (right[index]?.[column] ?? 0), 0)));
}

export function multiplyMatrixVector(matrix: readonly (readonly number[])[], vector: readonly number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * (vector[index] ?? 0), 0));
}

export function transpose(matrix: readonly (readonly number[])[]): number[][] {
  const columns = matrix[0]?.length ?? 0;
  return Array.from({ length: columns }, (_, column) => matrix.map((row) => row[column] ?? 0));
}

export function outerProduct(vector: readonly number[]): number[][] {
  return vector.map((left) => vector.map((right) => left * right));
}

export function addMatrices(left: readonly (readonly number[])[], right: readonly (readonly number[])[]): number[][] {
  return left.map((row, rowIndex) => row.map((value, columnIndex) => value + (right[rowIndex]?.[columnIndex] ?? 0)));
}

export function zeroMatrix(size: number): number[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
}

export function linearSlope(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const xMean = (values.length - 1) / 2;
  const yMean = mean(values);
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, index) => {
    numerator += (index - xMean) * (value - yMean);
    denominator += (index - xMean) ** 2;
  });
  return denominator === 0 ? 0 : numerator / denominator;
}
