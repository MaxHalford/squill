import type { Directive, DirectiveBinding } from 'vue'

type TooltipValue = string | { text: string; position?: 'top' | 'bottom' }

let tooltipEl: HTMLDivElement | null = null
let showTimeout: ReturnType<typeof setTimeout> | null = null
let currentTarget: HTMLElement | null = null

// Store current value for each element so we can update while hovering
const currentValues = new WeakMap<HTMLElement, TooltipValue>()

const createTooltipElement = (): HTMLDivElement => {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div')
    tooltipEl.className = 'retro-tooltip'
    tooltipEl.setAttribute('role', 'tooltip')
    document.body.appendChild(tooltipEl)
  }
  return tooltipEl
}

const getTooltipText = (value: TooltipValue): string => {
  return typeof value === 'string' ? value : value.text
}

const getPosition = (value: TooltipValue): 'top' | 'bottom' => {
  return typeof value === 'string' ? 'top' : (value.position ?? 'top')
}

const showTooltip = (el: HTMLElement) => {
  const value = currentValues.get(el)
  if (!value) return

  const text = getTooltipText(value)
  if (!text) return

  // Clear any pending show
  if (showTimeout) {
    clearTimeout(showTimeout)
  }

  currentTarget = el

  // Small delay to prevent flicker on quick mouse movements
  showTimeout = setTimeout(() => {
    if (currentTarget !== el) return

    const tooltip = createTooltipElement()
    tooltip.textContent = text
    tooltip.style.display = 'block'
    tooltip.classList.remove('visible')

    // Need to measure after display
    requestAnimationFrame(() => {
      if (currentTarget !== el) {
        tooltip.style.display = 'none'
        return
      }

      const rect = el.getBoundingClientRect()
      const tooltipRect = tooltip.getBoundingClientRect()
      const position = getPosition(value)

      let top: number
      let left: number

      if (position === 'bottom') {
        top = rect.bottom + 6
      } else {
        top = rect.top - tooltipRect.height - 6
      }

      left = rect.left + (rect.width - tooltipRect.width) / 2

      // Keep within viewport
      const margin = 8
      left = Math.max(margin, Math.min(left, window.innerWidth - tooltipRect.width - margin))

      // If top position would be off-screen, flip to bottom
      if (position === 'top' && top < margin) {
        top = rect.bottom + 6
      }
      // If bottom position would be off-screen, flip to top
      if (position === 'bottom' && top + tooltipRect.height > window.innerHeight - margin) {
        top = rect.top - tooltipRect.height - 6
      }

      tooltip.style.top = `${top}px`
      tooltip.style.left = `${left}px`
      tooltip.classList.add('visible')
    })
  }, 50) // 50ms delay - feels instant but prevents flicker
}

// Update tooltip content if it's currently visible for this element
const updateVisibleTooltip = (el: HTMLElement) => {
  if (currentTarget !== el || !tooltipEl) return

  const value = currentValues.get(el)
  if (!value) return

  const text = getTooltipText(value)
  if (text && tooltipEl.classList.contains('visible')) {
    tooltipEl.textContent = text
  }
}

const hideTooltip = () => {
  if (showTimeout) {
    clearTimeout(showTimeout)
    showTimeout = null
  }
  currentTarget = null
  if (tooltipEl) {
    tooltipEl.classList.remove('visible')
  }
}

// Store handlers on elements for proper cleanup
const handlers = new WeakMap<HTMLElement, {
  mouseenter: () => void
  mouseleave: () => void
  focus: () => void
  blur: () => void
}>()

export const vTooltip: Directive<HTMLElement, TooltipValue> = {
  mounted(el, binding: DirectiveBinding<TooltipValue>) {
    if (!binding.value) return

    // Store the current value
    currentValues.set(el, binding.value)

    const h = {
      mouseenter: () => showTooltip(el),
      mouseleave: hideTooltip,
      focus: () => showTooltip(el),
      blur: hideTooltip,
    }

    handlers.set(el, h)
    el.addEventListener('mouseenter', h.mouseenter)
    el.addEventListener('mouseleave', h.mouseleave)
    el.addEventListener('focus', h.focus)
    el.addEventListener('blur', h.blur)
  },

  updated(el, binding: DirectiveBinding<TooltipValue>) {
    // Update the stored value
    if (binding.value) {
      currentValues.set(el, binding.value)
      // If tooltip is currently visible for this element, update its content
      updateVisibleTooltip(el)
    } else {
      currentValues.delete(el)
    }
  },

  unmounted(el) {
    const h = handlers.get(el)
    if (h) {
      el.removeEventListener('mouseenter', h.mouseenter)
      el.removeEventListener('mouseleave', h.mouseleave)
      el.removeEventListener('focus', h.focus)
      el.removeEventListener('blur', h.blur)
      handlers.delete(el)
    }
    currentValues.delete(el)
    hideTooltip()
  },
}
