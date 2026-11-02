import useVirtual from 'react-cool-virtual'

import { scale } from '../platform'

export const LIST_ITEM_SIZE = scale(32, 48)
export function useList(
  array: Readonly<any[]> = [],
  itemSize = LIST_ITEM_SIZE,
) {
  return useVirtual<HTMLDivElement>({
    itemCount: array.length,
    itemSize,
  })
}
