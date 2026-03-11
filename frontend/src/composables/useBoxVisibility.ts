import { ref, onMounted, onUnmounted, type Ref } from 'vue'

/**
 * Tracks whether an element is visible in the browser viewport using IntersectionObserver.
 * Used to skip rendering heavy content (e.g. ResultsTable) for off-screen boxes.
 *
 * Scoping the root to the canvas element (rather than the browser viewport) prevents
 * IO callbacks from firing en-masse when CSS zoom is committed on the viewport container,
 * since the root's bounds are stable across that change.
 */
export function useBoxVisibility(
  elementRef: Ref<HTMLElement | null>,
  rootMargin = '500px',
  rootRef?: Ref<HTMLElement | null>
) {
  const isVisible = ref(true) // Default visible to avoid flash on mount

  let observer: IntersectionObserver | null = null

  onMounted(() => {
    if (!elementRef.value) return

    observer = new IntersectionObserver(
      (entries) => {
        isVisible.value = entries[0].isIntersecting
      },
      { root: rootRef?.value ?? null, rootMargin, threshold: 0 }
    )
    observer.observe(elementRef.value)
  })

  onUnmounted(() => {
    observer?.disconnect()
    observer = null
  })

  return { isVisible }
}
