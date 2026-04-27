import { useQuery, useMutation } from '@tanstack/react-query'
import { ipc } from '../DawnPanelApp'

/**
 * 通过 IpcBridge 获取内存状态（带自动轮询）
 */
export function useMemoryState() {
  return useQuery({
    queryKey: ['memory'],
    queryFn: () => ipc.invoke('memory'),
    refetchInterval: 15_000,
  })
}

/**
 * 通过 IpcBridge 获取上下文状态（带自动轮询）
 */
export function useContextState() {
  return useQuery({
    queryKey: ['context'],
    queryFn: () => ipc.invoke('context'),
    refetchInterval: 15_000,
  })
}

/**
 * 执行任务（通过 IpcBridge）
 */
export function useRunTask() {
  return useMutation({
    mutationFn: (task: string) => ipc.invoke<{ response: string; sidePanel?: any }>('runFullTask', task),
  })
}
