<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

import { useI18n } from '../i18n'

const props = defineProps<{ open: boolean; error?: string | null; initialName?: string }>()
const emit = defineEmits<{ submit: [pin: string, name: string]; cancel: [] }>()
const { t } = useI18n()

const pin = ref('')
const name = ref(props.initialName ?? '')
const pinInput = ref<HTMLInputElement | null>(null)

watch(
  () => props.open,
  async (open) => {
    if (open) {
      pin.value = ''
      name.value = props.initialName ?? ''
      await nextTick()
      pinInput.value?.focus()
    }
  },
)

function submit(): void {
  if (!/^\d{6}$/.test(pin.value)) return
  emit('submit', pin.value, name.value.trim())
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('cancel')">
    <form class="modal" @submit.prevent="submit">
      <h2>{{ t('pi.pinTitle') }}</h2>
      <p class="small muted">{{ t('pi.pinHint') }}</p>
      <label class="field-group">
        <span class="label">{{ t('pi.pin') }}</span>
        <input
          ref="pinInput"
          v-model="pin"
          class="field field-code"
          type="password"
          inputmode="numeric"
          pattern="[0-9]{6}"
          maxlength="6"
          autocomplete="one-time-code"
          required
        />
      </label>
      <label class="field-group">
        <span class="label">{{ t('pi.pinName') }}</span>
        <input v-model="name" class="field" type="text" maxlength="40" autocomplete="nickname" />
      </label>
      <p v-if="error" class="notice notice-danger">{{ error }}</p>
      <div class="row">
        <button type="button" class="btn grow" @click="emit('cancel')">{{ t('common.cancel') }}</button>
        <button type="submit" class="btn btn-primary grow" :disabled="pin.length !== 6">{{ t('common.save') }}</button>
      </div>
    </form>
  </div>
</template>
