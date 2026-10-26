import { useQuery } from '@tanstack/react-query'
import api from '~/lib/api'
import type { FieldState } from '../../types/field'

export const FIELD_STATE_QUERY_KEY = ['field-state']

/** Live GPS, aircraft and sky data, refreshed every second while `enabled`. */
export const useFieldState = (enabled = true) => {
  return useQuery<FieldState>({
    queryKey: FIELD_STATE_QUERY_KEY,
    queryFn: () => api.getFieldState(),
    enabled,
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
    retry: false,
  })
}
