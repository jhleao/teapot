# Teapot

## Installation

### macOS

1. Download the latest release from [Releases](https://github.com/jhleao/teapot/releases)
2. Open the downloaded DMG or extract the ZIP file
3. Move `teapot.app` to your Applications folder

**Important:** macOS will show a security warning ("teapot.app is damaged and can't be opened") because the app is not code-signed with an Apple Developer certificate. This is a standard macOS Gatekeeper protection for unsigned applications.

To bypass this security warning, run this command in your terminal:

```bash
xattr -c /Applications/teapot.app
```

**Note:** This workaround is only required on first launch. The app includes an automatic updater that handles future updates seamlessly.

### Windows

1. Download the latest release from [Releases](https://github.com/jhleao/teapot/releases)
2. Run the installer (`teapot-[version]-setup.exe`)
3. Follow the installation wizard

### Linux

1. Download the latest release from [Releases](https://github.com/jhleao/teapot/releases)
2. Make the AppImage executable and run it:

```bash
chmod +x teapot-[version].AppImage
./teapot-[version].AppImage
```
