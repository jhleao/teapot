/**
 * Agent-driven Electron app driver for UI development feedback loop.
 *
 * Usage:
 *   pnpm tsx scripts/e2e-agent-driver.ts <command> [args...]
 *
 * Commands:
 *   screenshot [path]     - Take screenshot (default: /tmp/teapot-screenshot.png)
 *   snapshot              - Get accessibility tree snapshot
 *   click <testid>        - Click element by data-testid
 *   type <testid> <text>  - Type text into element
 *   press <key>           - Press keyboard key (Enter, Escape, Tab, etc.)
 *   eval <script>         - Evaluate JS in renderer
 *   wait <testid>         - Wait for element to be visible
 *   html                  - Get page HTML
 *
 * The script maintains a running app instance. Use CTRL+C to close.
 */
import { _electron as electron, ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const MAIN_ENTRY = path.join(process.cwd(), 'out', 'main', 'index.js')

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  if (!fs.existsSync(MAIN_ENTRY)) {
    console.error('Build artifacts missing. Run `pnpm build` first.')
    process.exit(1)
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teapot-agent-'))

  const app = await electron.launch({
    args: [MAIN_ENTRY, '--no-sandbox'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      TEAPOT_E2E: '1',
      TEAPOT_E2E_USER_DATA: userDataDir
    }
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  console.log(`App launched. User data: ${userDataDir}`)
  return { app, page }
}

async function executeCommand(page: Page, command: string, args: string[]): Promise<string> {
  switch (command) {
    case 'screenshot': {
      const filePath = args[0] || '/tmp/teapot-screenshot.png'
      await page.screenshot({ path: filePath, fullPage: true })
      return `Screenshot saved to ${filePath}`
    }

    case 'snapshot': {
      const snapshot = await page.accessibility.snapshot()
      return JSON.stringify(snapshot, null, 2)
    }

    case 'click': {
      const testId = args[0]
      if (!testId) return 'Error: testid required'
      await page.getByTestId(testId).click()
      return `Clicked ${testId}`
    }

    case 'type': {
      const [testId, ...textParts] = args
      const text = textParts.join(' ')
      if (!testId || !text) return 'Error: testid and text required'
      await page.getByTestId(testId).fill(text)
      return `Typed "${text}" into ${testId}`
    }

    case 'press': {
      const key = args[0]
      if (!key) return 'Error: key required'
      await page.keyboard.press(key)
      return `Pressed ${key}`
    }

    case 'eval': {
      const script = args.join(' ')
      if (!script) return 'Error: script required'
      const result = await page.evaluate(script)
      return JSON.stringify(result, null, 2)
    }

    case 'wait': {
      const testId = args[0]
      if (!testId) return 'Error: testid required'
      await page.getByTestId(testId).waitFor({ state: 'visible', timeout: 10000 })
      return `${testId} is visible`
    }

    case 'html': {
      return await page.content()
    }

    case 'help':
      return `Commands: screenshot, snapshot, click, type, press, eval, wait, html, help, quit`

    default:
      return `Unknown command: ${command}. Use 'help' for list.`
  }
}

async function main() {
  const { app, page } = await launchApp()

  // If args provided, run single command and exit
  const [, , command, ...args] = process.argv
  if (command && command !== 'interactive') {
    try {
      const result = await executeCommand(page, command, args)
      console.log(result)
    } finally {
      await app.close()
    }
    return
  }

  // Interactive mode
  console.log('Interactive mode. Type "help" for commands, "quit" to exit.')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'teapot> '
  })

  rl.prompt()

  rl.on('line', async (line) => {
    const [cmd, ...cmdArgs] = line.trim().split(/\s+/)
    if (cmd === 'quit' || cmd === 'exit') {
      await app.close()
      rl.close()
      return
    }

    if (cmd) {
      try {
        const result = await executeCommand(page, cmd, cmdArgs)
        console.log(result)
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : error}`)
      }
    }
    rl.prompt()
  })

  rl.on('close', async () => {
    await app.close()
    process.exit(0)
  })
}

main().catch(console.error)
