import { sortBy as _sortBy, sum as _sum } from 'lodash';

export const sum = (array: number[]): number => {
  return _sum(array);
};

export const mean = (array: number[]): number => {
  const arraySum = sum(array);
  return arraySum / array.length;
};

export const median = (array: number[]): number => {
  array = _sortBy(array);

  if (array.length % 2 === 0) {
    // array with even number elements
    return (array[array.length / 2] + array[array.length / 2 - 1]) / 2;
  } else {
    return array[(array.length - 1) / 2]; // array with odd number elements
  }
};
