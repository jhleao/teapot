import { useEffect } from 'react'
import { toast } from 'sonner'

const RELEASES_URL = 'https://github.com/jhleao/teapot/releases'

export function useUpdateNotifications(): void {
  useEffect(() => {
    const cleanupDownloading = window.api.onUpdateDownloading((version) => {
      // Since we don't have Apple code signing yet, the auto updater fails to auto install.
      // So we just prompt the user to uninstall+reinstall cleanly. Instead.
      // Once code signing is added, this can just be uncommented as the flow will work again.
      // toast.info('Update available', {
      //   description: `Downloading version ${version}...`
      // })
      toast.info('New update available', {
        description: `Head to ${RELEASES_URL} to download the latest version (${version}).`
      })
    })

    // const cleanupDownloaded = window.api.onUpdateDownloaded((version) => {
    //   toast.success('Update ready', {
    //     description: `Version ${version} will be installed when you restart the app`
    //   })
    // })

    return () => {
      cleanupDownloading()
      // cleanupDownloaded()
    }
  }, [])
}
