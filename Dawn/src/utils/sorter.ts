function bubbleSort<T>(arr: T[], compare: (a: T, b: T) => number): T[] {
  const result = [...arr];
  for (let i = 0; i < result.length; i++) {
    for (let j = 0; j < result.length - i - 1; j++) {
      const a = result[j]!;
      const b = result[j + 1]!;
      if (compare(a, b) > 0) {
        result[j] = b;
        result[j + 1] = a;
      }
    }
  }
  return result;
}

function quickSort<T>(arr: T[], compare: (a: T, b: T) => number): T[] {
  if (arr.length <= 1) return arr;
  const pivot = arr[Math.floor(arr.length / 2)]!;
  const left = arr.filter(x => compare(x!, pivot) < 0);
  const middle = arr.filter(x => compare(x!, pivot) === 0);
  const right = arr.filter(x => compare(x!, pivot) > 0);
  return [...quickSort(left, compare), ...middle, ...quickSort(right, compare)];
}