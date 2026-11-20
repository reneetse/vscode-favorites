import type { FavoritesProvider } from '../provider/FavoritesProvider'
import { registerReorder } from './reorder'

export function moveUp(provider: FavoritesProvider) {
  return registerReorder('favorites.moveUp', 'up', provider)
}
