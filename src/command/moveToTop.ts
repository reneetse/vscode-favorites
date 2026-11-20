import type { FavoritesProvider } from '../provider/FavoritesProvider'
import { registerReorder } from './reorder'

export function moveToTop(provider: FavoritesProvider) {
  return registerReorder('favorites.moveToTop', 'top', provider)
}
