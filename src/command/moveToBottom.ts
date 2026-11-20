import type { FavoritesProvider } from '../provider/FavoritesProvider'
import { registerReorder } from './reorder'

export function moveToBottom(provider: FavoritesProvider) {
  return registerReorder('favorites.moveToBottom', 'bottom', provider)
}
