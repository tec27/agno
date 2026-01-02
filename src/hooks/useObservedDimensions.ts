import { useLayoutEffect, useState } from 'react'

export type DimensionsHookResult<T extends Element> = [
  ref: React.RefCallback<T>,
  dimensions?: { width: number; height: number },
]

function resolveDimensions(
  entry: ResizeObserverEntry,
  options?: ResizeObserverOptions,
): { width: number; height: number } {
  switch (options?.box) {
    case 'device-pixel-content-box':
      return entry.devicePixelContentBoxSize.reduce(
        (acc, size) => ({
          width: acc.width + size.inlineSize,
          height: acc.height + size.blockSize,
        }),
        { width: 0, height: 0 },
      )

    case 'content-box':
      return entry.contentBoxSize.reduce(
        (acc, size) => ({
          width: acc.width + size.inlineSize,
          height: acc.height + size.blockSize,
        }),
        { width: 0, height: 0 },
      )

    case 'border-box':
    default:
      return entry.borderBoxSize.reduce(
        (acc, size) => ({
          width: acc.width + size.inlineSize,
          height: acc.height + size.blockSize,
        }),
        { width: 0, height: 0 },
      )
  }
}

/**
 * A hook that returns the current width/height for an element. Included in the return value is a
 * `ref` that must be attached to the element you wish to measure. A ResizeObserver will be attached
 * to the `ref'd` element and return new dimension values when it changes. By default, the
 * `border-box` size will be returned, but you can change this with the options.
 */
export function useObservedDimensions<T extends Element>(
  options?: ResizeObserverOptions,
): DimensionsHookResult<T> {
  const [ref, observerEntry] = useResizeObserver<T>(options)
  const dimensions = observerEntry ? resolveDimensions(observerEntry, options) : undefined

  return [ref, dimensions]
}

type ResizeObserverHookCallback = (entry: ResizeObserverEntry) => void
const observedResizeElements = new WeakMap<Element, ResizeObserverHookCallback>()

function onResizeObserved(entries: ResizeObserverEntry[]) {
  for (const entry of entries) {
    const handler = observedResizeElements.get(entry.target)
    if (handler) {
      handler(entry)
    }
  }
}

// NOTE(tec27): Using multiple ResizeObservers seems to be a lot more expensive than using a single
// one to observe multiple elements, at least according to some casual googling. So instead of
// creating one for each hook, we lazily create a single one and use it for all of them.
const resizeObserver = new ResizeObserver(onResizeObserved)

export function useResizeObserver<T extends Element>(
  options: ResizeObserverOptions = {},
): [ref: React.RefCallback<T>, observerEntry: ResizeObserverEntry | undefined] {
  const [observerEntry, setObserverEntry] = useState<ResizeObserverEntry>()
  const [elem, setElem] = useState<T | null>(null)

  useLayoutEffect(() => {
    const onResize = (entry: ResizeObserverEntry) => {
      setObserverEntry(curEntry => {
        if (!curEntry) {
          return entry
        }

        let changed = false

        switch (options.box) {
          case 'device-pixel-content-box':
            changed = entry.devicePixelContentBoxSize.some(
              (boxSize, i) =>
                boxSize.inlineSize !== curEntry.devicePixelContentBoxSize[i].inlineSize ||
                boxSize.blockSize !== curEntry.devicePixelContentBoxSize[i].blockSize,
            )
            break

          case 'content-box':
            changed = entry.contentBoxSize.some(
              (boxSize, i) =>
                boxSize.inlineSize !== curEntry.contentBoxSize[i].inlineSize ||
                boxSize.blockSize !== curEntry.contentBoxSize[i].blockSize,
            )
            break

          case 'border-box':
          default:
            changed = entry.borderBoxSize.some(
              (boxSize, i) =>
                boxSize.inlineSize !== curEntry.borderBoxSize[i].inlineSize ||
                boxSize.blockSize !== curEntry.borderBoxSize[i].blockSize,
            )
            break
        }

        return changed ? entry : curEntry
      })
    }

    if (elem) {
      observedResizeElements.set(elem, onResize)
      resizeObserver.observe(elem, options)
      return () => {
        resizeObserver.unobserve(elem)
        observedResizeElements.delete(elem)
      }
    } else {
      return undefined
    }
  }, [elem, options])

  return [setElem, observerEntry]
}
