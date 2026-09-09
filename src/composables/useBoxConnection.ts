import { computed, type Ref } from 'vue'
import { useConnectionsStore } from '../stores/connections'

export function useBoxConnection(connectionId: Ref<string | undefined>) {
  const connectionsStore = useConnectionsStore()

  const connection = computed(() => {
    if (!connectionId.value) return null
    return connectionsStore.connections.find(c => c.id === connectionId.value) || null
  })

  const isConnectionMissing = computed(() => {
    if (!connectionId.value) return false
    return !connection.value
  })

  return { connection, isConnectionMissing }
}
