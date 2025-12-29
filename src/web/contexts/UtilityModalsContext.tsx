import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type PropsWithChildren
} from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/Dialog'

type ModalCopy = {
  title: string | React.ReactNode
  body: string | React.ReactNode
  dismissText?: string
  confirmText: string
  variant?: 'default' | 'destructive'
}

type ConfirmationModalParams = Partial<ModalCopy> & Pick<ModalCopy, 'body'>
type AlertModalParams = ConfirmationModalParams

export type UtilityModalsContextType = {
  confirmationModal: (params: ConfirmationModalParams) => Promise<boolean>
  alertModal: (params: AlertModalParams) => Promise<void>
}

const DEFAULT_VALUE: UtilityModalsContextType = {
  confirmationModal: async () => false,
  alertModal: async () => {}
}

const UtilityModalsContext = createContext<UtilityModalsContextType>(DEFAULT_VALUE)

// eslint-disable-next-line react-refresh/only-export-components
export const useUtilityModals = () => useContext(UtilityModalsContext)

const DEFAULT_MODAL_COPY = {
  confirmation: {
    title: 'Confirmation',
    dismissText: 'Cancel',
    confirmText: 'Confirm'
  },
  alert: {
    title: 'Alert',
    confirmText: 'OK'
  }
} as const

type ModalCallbacks = {
  onConfirm?: () => void
  onDismiss?: () => void
}

function GenericUtilityModal({
  copy,
  callbacks,
  isOpen
}: {
  copy: ModalCopy | null
  callbacks: ModalCallbacks | null
  isOpen: boolean
}) {
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) callbacks?.onDismiss?.()
    },
    [callbacks]
  )

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          {typeof copy?.body === 'string' ? (
            <DialogDescription>{copy.body}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{copy?.title}</DialogDescription>
          )}
        </DialogHeader>
        {typeof copy?.body !== 'string' && <div className="my-2">{copy?.body}</div>}
        <DialogFooter>
          {copy?.dismissText && (
            <button
              onClick={callbacks?.onDismiss}
              className="border-border bg-muted text-foreground hover:bg-muted/80 rounded border px-3 py-1 text-sm transition-colors"
            >
              {copy.dismissText}
            </button>
          )}
          {copy?.confirmText && (
            <button
              onClick={callbacks?.onConfirm}
              className={
                copy.variant === 'destructive'
                  ? 'bg-error hover:bg-error/90 rounded border border-transparent px-3 py-1 text-sm text-white transition-colors'
                  : 'bg-accent text-accent-foreground hover:bg-accent/90 rounded border border-transparent px-3 py-1 text-sm transition-colors'
              }
            >
              {copy.confirmText}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function UtilityModalsProvider({ children }: PropsWithChildren) {
  const [modalCopy, setModalCopy] = useState<ModalCopy | null>(null)
  const [modalCallbacks, setModalCallbacks] = useState<ModalCallbacks | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const copyResetTimeout = useRef<NodeJS.Timeout | null>(null)

  const onClose = useCallback(() => {
    setIsOpen(false)
    if (copyResetTimeout.current) clearTimeout(copyResetTimeout.current)
    copyResetTimeout.current = setTimeout(() => {
      setModalCopy(null)
      setModalCallbacks(null)
    }, 300)
  }, [])

  const confirmationModal = useCallback(
    async (params: ConfirmationModalParams): Promise<boolean> => {
      const mergedParams: ModalCopy = {
        ...DEFAULT_MODAL_COPY.confirmation,
        ...params
      }
      if (copyResetTimeout.current) clearTimeout(copyResetTimeout.current)
      setModalCopy(mergedParams)
      setIsOpen(true)
      return new Promise<boolean>((resolve) => {
        const handleConfirm = () => {
          resolve(true)
          onClose()
        }
        const handleDismiss = () => {
          resolve(false)
          onClose()
        }
        setModalCallbacks({
          onConfirm: handleConfirm,
          onDismiss: handleDismiss
        })
      })
    },
    [onClose]
  )

  const alertModal = useCallback(
    async (params: AlertModalParams): Promise<void> => {
      const mergedParams: ModalCopy = {
        ...DEFAULT_MODAL_COPY.alert,
        ...params
      }
      if (copyResetTimeout.current) clearTimeout(copyResetTimeout.current)
      setModalCopy(mergedParams)
      setIsOpen(true)
      return new Promise<void>((resolve) => {
        const handleConfirm = () => {
          resolve()
          onClose()
        }
        const handleDismiss = () => {
          resolve()
          onClose()
        }
        setModalCallbacks({
          onConfirm: handleConfirm,
          onDismiss: handleDismiss
        })
      })
    },
    [onClose]
  )

  const value: UtilityModalsContextType = {
    confirmationModal,
    alertModal
  }

  return (
    <UtilityModalsContext.Provider value={value}>
      {children}
      <GenericUtilityModal copy={modalCopy} callbacks={modalCallbacks} isOpen={isOpen} />
    </UtilityModalsContext.Provider>
  )
}
