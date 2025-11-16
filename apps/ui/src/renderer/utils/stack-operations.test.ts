import type { UiStack } from '@teapot/contract'
import { buildOptimisticDrag } from './stack-operations'

// Test case: dragging a commit from a spinoff to create a new spinoff
function testDragCommitFromSpinoffToMainStack() {
  const inputStack: UiStack = {
    commits: [
      {
        sha: '83afb7ac-c00b-4da2-8c89-4f32dcc4126a',
        name: 'Initial commit',
        timestampMs: 1763117098265,
        spinoffs: [],
        branches: [
          {
            name: 'main',
            isCurrent: false
          }
        ]
      },
      {
        sha: '75f7ae62-a6d6-4084-8f47-4987dde8f94f',
        name: 'Add basic project structure',
        timestampMs: 1763124298265,
        spinoffs: [],
        branches: [
          {
            name: 'main',
            isCurrent: false
          }
        ]
      },
      {
        sha: 'f21d06f8-96d0-4ddb-b48a-4233c88fcdbc',
        name: 'Implement core functionality',
        timestampMs: 1763131498265,
        spinoffs: [
          {
            commits: [
              {
                sha: 'b79a0982-8536-413d-8829-3627c862736f',
                name: 'Update helper (1/2)',
                timestampMs: 1763138698265,
                spinoffs: [],
                branches: [
                  {
                    name: 'bugfix/security',
                    isCurrent: false
                  }
                ]
              },
              {
                sha: '50b12795-cab8-416d-8966-205dbed464ad',
                name: 'Optimize helper (final)',
                timestampMs: 1763145898265,
                spinoffs: [],
                branches: [
                  {
                    name: 'feature/realtime',
                    isCurrent: true
                  },
                  {
                    name: 'feature/mobile-api',
                    isCurrent: false
                  }
                ]
              },
              {
                sha: '12345-cab8-416d-8966-205dbed464ad',
                name: 'Optimize helper (final final)',
                timestampMs: 1763145898265,
                spinoffs: [],
                branches: [
                  {
                    name: 'feature/realtime',
                    isCurrent: true
                  },
                  {
                    name: 'feature/mobile-api',
                    isCurrent: false
                  }
                ]
              }
            ],
            isTrunk: false
          }
        ],
        branches: [
          {
            name: 'main',
            isCurrent: false
          }
        ]
      },
      {
        sha: '9de86d20-f12f-4d74-b445-d2bc04d8d64a',
        name: 'Add tests for core module',
        timestampMs: 1763138698265,
        spinoffs: [],
        branches: [
          {
            name: 'main',
            isCurrent: false
          }
        ]
      },
      {
        sha: '95aa4a60-c902-442c-b1c0-6de766cf3844',
        name: 'Refactor API layer',
        timestampMs: 1763145898265,
        spinoffs: [],
        branches: [
          {
            name: 'main',
            isCurrent: true
          },
          {
            name: 'feature/file-upload',
            isCurrent: false
          }
        ]
      }
    ],
    isTrunk: true
  }

  const expectedStack: UiStack = {
    commits: [
      {
        sha: '83afb7ac-c00b-4da2-8c89-4f32dcc4126a',
        name: 'Initial commit',
        timestampMs: 1763117098265,
        spinoffs: [],
        branches: [
          {
            name: 'main',
            isCurrent: false
          }
        ]
      },
      {
        sha: '75f7ae62-a6d6-4084-8f47-4987dde8f94f',
        name: 'Add basic project structure',
        timestampMs: 1763124298265,
        spinoffs: [
          {
            commits: [
              {
                sha: '50b12795-cab8-416d-8966-205dbed464ad',
                name: 'Optimize helper (final)',
                timestampMs: 1763145898265,
                spinoffs: [],
                branches: [
                  {
                    name: 'feature/realtime',
                    isCurrent: true
                  },
                  {
                    name: 'feature/mobile-api',
                    isCurrent: false
                  }
                ]
              },
              {
                sha: '12345-cab8-416d-8966-205dbed464ad',
                name: 'Optimize helper (final final)',
                timestampMs: 1763145898265,
                spinoffs: [],
                branches: [
                  {
                    name: 'feature/realtime',
                    isCurrent: true
                  },
                  {
                    name: 'feature/mobile-api',
                    isCurrent: false
                  }
                ]
              }
            ],
            isTrunk: false
          }
        ],
        branches: [
          {
            name: 'main',
            isCurrent: false
          }
        ]
      },
      {
        sha: 'f21d06f8-96d0-4ddb-b48a-4233c88fcdbc',
        name: 'Implement core functionality',
        timestampMs: 1763131498265,
        spinoffs: [
          {
            commits: [
              {
                sha: 'b79a0982-8536-413d-8829-3627c862736f',
                name: 'Update helper (1/2)',
                timestampMs: 1763138698265,
                spinoffs: [],
                branches: [
                  {
                    name: 'bugfix/security',
                    isCurrent: false
                  }
                ]
              }
            ],
            isTrunk: false
          }
        ],
        branches: [
          {
            name: 'main',
            isCurrent: false
          }
        ]
      },
      {
        sha: '9de86d20-f12f-4d74-b445-d2bc04d8d64a',
        name: 'Add tests for core module',
        timestampMs: 1763138698265,
        spinoffs: [],
        branches: [
          {
            name: 'main',
            isCurrent: false
          }
        ]
      },
      {
        sha: '95aa4a60-c902-442c-b1c0-6de766cf3844',
        name: 'Refactor API layer',
        timestampMs: 1763145898265,
        spinoffs: [],
        branches: [
          {
            name: 'main',
            isCurrent: true
          },
          {
            name: 'feature/file-upload',
            isCurrent: false
          }
        ]
      }
    ],
    isTrunk: true
  }

  const result = buildOptimisticDrag(
    inputStack,
    '50b12795-cab8-416d-8966-205dbed464ad',
    '75f7ae62-a6d6-4084-8f47-4987dde8f94f'
  )

  const resultJson = JSON.stringify(result, null, 2)
  const expectedJson = JSON.stringify(expectedStack, null, 2)

  if (resultJson === expectedJson) {
    console.log('✅ Test passed!')
    return true
  } else {
    console.error('❌ Test failed!')
    console.error('Expected:')
    console.error(expectedJson)
    console.error('\nGot:')
    console.error(resultJson)
    return false
  }
}

// Test case 2: dragging a commit to the head of a stack (should append, not create spinoff)
function testDragToHeadOfStack() {
  const inputStack: UiStack = {
    commits: [
      {
        sha: 'commit-1',
        name: 'First commit',
        timestampMs: 1000,
        spinoffs: [],
        branches: [{ name: 'main', isCurrent: false }]
      },
      {
        sha: 'commit-2',
        name: 'Second commit',
        timestampMs: 2000,
        spinoffs: [
          {
            commits: [
              {
                sha: 'spinoff-1',
                name: 'Spinoff commit 1',
                timestampMs: 2500,
                spinoffs: [],
                branches: [{ name: 'feature-a', isCurrent: false }]
              },
              {
                sha: 'spinoff-2',
                name: 'Spinoff commit 2',
                timestampMs: 3000,
                spinoffs: [],
                branches: [{ name: 'feature-a', isCurrent: true }]
              }
            ],
            isTrunk: false
          }
        ],
        branches: [{ name: 'main', isCurrent: false }]
      },
      {
        sha: 'commit-3',
        name: 'Third commit (HEAD)',
        timestampMs: 4000,
        spinoffs: [],
        branches: [{ name: 'main', isCurrent: false }]
      }
    ],
    isTrunk: true
  }

  const expectedStack: UiStack = {
    commits: [
      {
        sha: 'commit-1',
        name: 'First commit',
        timestampMs: 1000,
        spinoffs: [],
        branches: [{ name: 'main', isCurrent: false }]
      },
      {
        sha: 'commit-2',
        name: 'Second commit',
        timestampMs: 2000,
        spinoffs: [
          {
            commits: [
              {
                sha: 'spinoff-1',
                name: 'Spinoff commit 1',
                timestampMs: 2500,
                spinoffs: [],
                branches: [{ name: 'feature-a', isCurrent: false }]
              }
            ],
            isTrunk: false
          }
        ],
        branches: [{ name: 'main', isCurrent: false }]
      },
      {
        sha: 'commit-3',
        name: 'Third commit (HEAD)',
        timestampMs: 4000,
        spinoffs: [],
        branches: [{ name: 'main', isCurrent: false }]
      },
      // These should be appended to the main stack, not added as a spinoff
      {
        sha: 'spinoff-2',
        name: 'Spinoff commit 2',
        timestampMs: 3000,
        spinoffs: [],
        branches: [{ name: 'feature-a', isCurrent: true }]
      }
    ],
    isTrunk: true
  }

  const result = buildOptimisticDrag(inputStack, 'spinoff-2', 'commit-3')

  const resultJson = JSON.stringify(result, null, 2)
  const expectedJson = JSON.stringify(expectedStack, null, 2)

  if (resultJson === expectedJson) {
    console.log('✅ Test 2 passed!')
    return true
  } else {
    console.error('❌ Test 2 failed!')
    console.error('Expected:')
    console.error(expectedJson)
    console.error('\nGot:')
    console.error(resultJson)
    return false
  }
}

// Run the tests
const test1Pass = testDragCommitFromSpinoffToMainStack()
const test2Pass = testDragToHeadOfStack()

if (test1Pass && test2Pass) {
  console.log('\n✅ All tests passed!')
} else {
  console.log('\n❌ Some tests failed')
  process.exit(1)
}
