import { ref, onMounted, onUnmounted, type Ref } from 'vue'

/**
 * Tracks whether an element is visible in the browser viewport using IntersectionObserver.
 * Used to skip rendering heavy content (e.g. ResultsTable) for off-screen boxes.
 */
export function useBoxVisibility(
  elementRef: Ref<HTMLElement | null>,
  rootMargin = '500px'
) {
  const isVisible = ref(true) // Default visible to avoid flash on mount

  let observer: IntersectionObserver | null = null

  onMounted(() => {
    if (!elementRef.value) return

    observer = new IntersectionObserver(
      (entries) => {
        isVisible.value = entries[0].isIntersecting
      },
      { rootMargin, threshold: 0 }
    )
    observer.observe(elementRef.value)
  })

  onUnmounted(() => {
    observer?.disconnect()
    observer = null
  })

  return { isVisible }
}
