import Shepherd from 'shepherd.js'
import 'shepherd.js/dist/css/shepherd.css'

let activeTour: InstanceType<typeof Shepherd.Tour> | null = null

export function startTutorial() {
  activeTour?.cancel()

  const tour = new Shepherd.Tour({
    useModalOverlay: true,
    defaultStepOptions: {
      cancelIcon: { enabled: true },
      classes: 'squill-tour',
      canClickTarget: false,
      modalOverlayOpeningPadding: 6,
      scrollTo: { behavior: 'smooth', block: 'center' },
    },
  })
  activeTour = tour

  const back = {
    text: 'Back',
    classes: 'shepherd-button-secondary',
    action: () => tour.back(),
  }
  const next = {
    text: 'Next',
    action: () => tour.next(),
  }

  tour.addStep({
    id: 'welcome',
    title: 'Welcome to Squill',
    text: 'Squill is a local-first SQL canvas. Your canvases and query results stay in this browser.',
    buttons: [{ text: 'Start', action: () => tour.next() }],
  })

  tour.addStep({
    id: 'connection',
    title: 'Choose where SQL runs',
    text: 'DuckDB runs locally with no sign-in. Use this menu when you want to connect BigQuery or switch accounts.',
    attachTo: { element: '[data-tour="connection-menu"]', on: 'bottom' },
    buttons: [back, next],
  })

  tour.addStep({
    id: 'new-box',
    title: 'Add a box',
    text: 'Add SQL editors, schema browsers, notes, query history, and column analytics from the New menu.',
    attachTo: { element: '[data-tour="new-menu"]', on: 'bottom' },
    buttons: [back, next],
  })

  tour.addStep({
    id: 'canvas',
    title: 'Arrange your work',
    text: 'Drag boxes around the canvas. Hold Space to pan, scroll to zoom, and connect queries by referring to another SQL box by name.',
    attachTo: { element: '[data-tour="canvas"]', on: 'top' },
    buttons: [back, next],
  })

  tour.addStep({
    id: 'settings',
    title: 'Make it yours',
    text: 'Settings controls the editor, canvas, pagination, notifications, and the optional OpenAI line fixer.',
    attachTo: { element: '[data-tour="settings"]', on: 'bottom' },
    buttons: [back, next],
  })

  tour.addStep({
    id: 'run-explicitly',
    title: 'You stay in control',
    text: 'Queries run only when you press Run.',
    buttons: [back, { text: 'Done', action: () => tour.complete() }],
  })

  tour.on('cancel', () => { activeTour = null })
  tour.on('complete', () => { activeTour = null })
  void tour.start()
}
