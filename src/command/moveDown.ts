import type { FavoritesProvider } from '../provider/FavoritesProvider'
import { registerReorder } from './reorder'

export function moveDown(provider: FavoritesProvider) {
  return registerReorder('favorites.moveDown', 'down', provider)
}
