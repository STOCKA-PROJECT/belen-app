import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
  error: boolean
}

/** Toasts and connectivity, shared by every view. */
export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  let nextId = 1

  function toast(message: string, error = false): void {
    const id = nextId++
    toasts.value.push({ id, message, error })
    setTimeout(() => dismiss(id), error ? 6000 : 3000)
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((x) => x.id !== id)
  }

  function setOnline(value: boolean): void {
    online.value = value
  }

  return { toasts, online, toast, dismiss, setOnline }
})
