# Changelog

## [0.9.0](https://github.com/jhleao/teapot/compare/v0.8.0...v0.9.0) (2026-02-06)


### Features

* add comprehensive E2E testing infrastructure ([f045462](https://github.com/jhleao/teapot/commit/f045462bc43a5a4c6b617b2691ed55938016b16d))
* add feature flag to disable parallel worktree mode ([0c91dd5](https://github.com/jhleao/teapot/commit/0c91dd5ffdcba82a7e8e21279254aa23a93a8c47))
* make repo selector sticky and more compact ([36b9faf](https://github.com/jhleao/teapot/commit/36b9fafb04e7adf4446ad55e6bd8ea8122ef2a4f))


### Bug Fixes

* branch badge dropdown ([071b3de](https://github.com/jhleao/teapot/commit/071b3de6b4be40187fe4d29ecec52bd68551d518))
* commit identity handling ([7e6ee13](https://github.com/jhleao/teapot/commit/7e6ee1370cead4b77576a71315239af3b7084b30))
* env var passing from os ([c2efd00](https://github.com/jhleao/teapot/commit/c2efd00a6ab0d7806090d99906cf2b459c0a3385))
* git forge issues/cleanup ([4c505bf](https://github.com/jhleao/teapot/commit/4c505bf99e8b70099e30e47421db4860f8bab2f3))
* minor visual fixes ([d5cecf5](https://github.com/jhleao/teapot/commit/d5cecf54dd361198c7f309def5c047d270fadea4))
* pr approval line item ([db3dff2](https://github.com/jhleao/teapot/commit/db3dff290b0dd674dc50d95649064cb38cd9c56a))
* recursive git watching ([a37543f](https://github.com/jhleao/teapot/commit/a37543f38f3ea004144fae22e873e2e3b9b8f434))
* restore drag initiation from entire commit row ([54dea96](https://github.com/jhleao/teapot/commit/54dea967dabde0108583c97b24bcb595ff918eb2))

## [0.8.0](https://github.com/jhleao/teapot/compare/v0.7.0...v0.8.0) (2026-01-26)

### Features

- add "Open in..." options to branch context menu for branches with worktrees ([d9bd326](https://github.com/jhleao/teapot/commit/d9bd326cd3e73778b9c9262eec090129c1458046))
- add clone repository option to repo selector ([ac675af](https://github.com/jhleao/teapot/commit/ac675af7c0605a9dee1a3351fa45914d9f2f9a56))
- add comprehensive trunk branch protection ([2e07324](https://github.com/jhleao/teapot/commit/2e07324685bc4b0e112b5ec7452324e70533de68))
- add customizable folder name for clone with validation ([541b6fe](https://github.com/jhleao/teapot/commit/541b6fe6b8406fc2de100783e62d20788d9f8e1a))
- add debug logging for troubleshooting stuck states ([d0c80d8](https://github.com/jhleao/teapot/commit/d0c80d8cfd85dc9eaabe28d5136efa054c9a7989))
- add edit commit message to commit context menu ([268508c](https://github.com/jhleao/teapot/commit/268508c9f3b92fe842cefa6a16400f565343755a))
- add fold-into-parent operation with patch-based squash ([3f65a78](https://github.com/jhleao/teapot/commit/3f65a7885ec57d00aa4fa748268d4ed237cf0197))
- add MultiBranchBadge for compact display of multiple branches on same commit ([701cdd6](https://github.com/jhleao/teapot/commit/701cdd6d63e5e9c9143a799149f9779f9b24cc88))
- add parallel mode for operations with dirty worktree ([de6ab25](https://github.com/jhleao/teapot/commit/de6ab2521322ba98a946cc3946c99b81102dfde3))
- Add PR status checks display with CI integration ([3d7a090](https://github.com/jhleao/teapot/commit/3d7a0907b3581aa53a8e4c6a68669d39324f52b1))
- always rebase on temp worktree with Open in Editor actions ([9c84a9f](https://github.com/jhleao/teapot/commit/9c84a9f89bcc59148be9f656a65f9f4f63d8208c))
- close PR when deleting branch via context menu ([f9ad460](https://github.com/jhleao/teapot/commit/f9ad460c6630bf02d5354cdcf89ae04982f1d003))
- delete remote branch when uncommitting ([36bf710](https://github.com/jhleao/teapot/commit/36bf710319cfc0afd231f7ce37459b2221ec046a))
- enable parallel rebase workflows with dirty worktree ([a6e2243](https://github.com/jhleao/teapot/commit/a6e22431058ad3f93edd9294ce0059a4a7780b6f))
- fast forward merge support ([c82e55b](https://github.com/jhleao/teapot/commit/c82e55bc7e40cab709246fb067145c5b2dccc25a))
- harden worktree conflict handling ([30bf806](https://github.com/jhleao/teapot/commit/30bf80696ab00225877a8d04080d69832034a469))
- improve file logging with level selection, async writes, and rotation ([2d4d1e8](https://github.com/jhleao/teapot/commit/2d4d1e8c41c78d8424bd4c81b04a14af7d31e60c))
- make commits with multiple spinoffs independent (fork points) ([4f7b01c](https://github.com/jhleao/teapot/commit/4f7b01c504477bc46f5c999c966abd874349421e))
- migrate GitHub API to GraphQL and add rate limit handling ([32b8452](https://github.com/jhleao/teapot/commit/32b84525bdbd70d4162f1f55c330648fcfa6abfe))
- pr base awareness, block creating pr when base is not in remote ([779f37b](https://github.com/jhleao/teapot/commit/779f37bf89543ad114b143af975ba598c95c90ca))
- re-activate Ship It button with bug fixes ([c5f2060](https://github.com/jhleao/teapot/commit/c5f20608c6f5114e21080fa81e42c9f666ecc3fc))
- replace "Fold into parent" with "Squash into parent" ([8855cd3](https://github.com/jhleao/teapot/commit/8855cd3e10bb312419f4caa6a7aaa7590b64ca1a))
- show "Open in..." for currently checked out branch ([f9f78bd](https://github.com/jhleao/teapot/commit/f9f78bdec99384f456d3421478264af02375dfcc))
- Show disabled "Delete branch" menu option with tooltip ([1cc1b5b](https://github.com/jhleao/teapot/commit/1cc1b5b1d8d8e040bc32a0205792e195c27bf4e9))
- ui pass ([7bd498d](https://github.com/jhleao/teapot/commit/7bd498da618e6e3c08470a4a6c0e20c9f751b820))
- unify popover implementation ([c5706db](https://github.com/jhleao/teapot/commit/c5706db2db66ca65146eb985061aa6bff3f2e080))
- validate temp worktree registration on context load ([79e2539](https://github.com/jhleao/teapot/commit/79e253986a60f8a0277f383cd1f82675bcc97033))

### Bug Fixes

- always create temp worktrees at trunk with detached HEAD ([efd45a7](https://github.com/jhleao/teapot/commit/efd45a7263c7e51be2d3c45be525bfde9cb0c226))
- block syncTrunk when user has dirty tree on trunk branch ([c019a98](https://github.com/jhleao/teapot/commit/c019a98c3c2beaf7e8eec3e20c6a61adb0b522c7))
- clean up commit context menu and fix tooltip styling ([afef989](https://github.com/jhleao/teapot/commit/afef989b9bb166e7116901975932d78d0cfb17b2))
- cleanup branch removes worktree first if branch is checked out there ([ea4099d](https://github.com/jhleao/teapot/commit/ea4099d1dd2b3214e84aa55a68de8ed33fccd23a))
- clear timeout timer on success in SimpleGitAdapter.withTimeout ([b8f1a7f](https://github.com/jhleao/teapot/commit/b8f1a7f0ccf4bb5d4e19db336be600eec3b56b23))
- correct drag position calculation during scroll and add auto-scroll ([34b7ff6](https://github.com/jhleao/teapot/commit/34b7ff6f0dff7822d5bcd5e2e63723d259361c28))
- declutter trunk by stripping all intermediate useless commits ([b37212c](https://github.com/jhleao/teapot/commit/b37212c2bf57aa75903c619f52e870476d4fcda6))
- delete branch removes associated worktree first ([364d875](https://github.com/jhleao/teapot/commit/364d8751aac042c3b5663f529cb30cb2b364fcc9))
- delete remote branch when deleting branch with closed PR ([d447ad9](https://github.com/jhleao/teapot/commit/d447ad9d1047fe0e718ab168efa554d6eacbbe15))
- delete remote-tracking refs during branch cleanup ([9956b4d](https://github.com/jhleao/teapot/commit/9956b4d27a3df5cf9bb3014da9df2b3e714b0736))
- detect dirty worktree mid-rebase and show actionable error ([8c9d030](https://github.com/jhleao/teapot/commit/8c9d030e91313d0d96c2bbdc90cb99351f79578b))
- edit commit message button state and tooltip issues ([0ff5609](https://github.com/jhleao/teapot/commit/0ff5609f3668e28bfd70b0dcba474d7116109b1b))
- extract ThemeContext to fix portal context error ([78a848e](https://github.com/jhleao/teapot/commit/78a848e99ea6ec2673e60e25538c715492591acf))
- guard cleanup API state updates ([09f922a](https://github.com/jhleao/teapot/commit/09f922ab75af505344572caa5d0c3e89e9a3db3b))
- handle disposed render frame in IPC sends ([b9c4846](https://github.com/jhleao/teapot/commit/b9c4846cf3b17ddb5140ad90435399bbce145b34))
- handle stale worktree references causing checkout failures ([dcf8813](https://github.com/jhleao/teapot/commit/dcf88131c72b6f947566ae0e5394bc4455dfc19c))
- improve merge strategy labels in settings dialog ([de9af53](https://github.com/jhleao/teapot/commit/de9af5340c99c725b5be7b5870ec2d81a177e96c))
- improve multi-commit branch handling and drag highlighting ([bc6ae04](https://github.com/jhleao/teapot/commit/bc6ae0476a803eebb5c158838d3ae4f5dba0749c))
- include branchless ancestor commits in rebase operations ([3e61f1a](https://github.com/jhleao/teapot/commit/3e61f1a2a48753718095735670ccedbdb79a1e45))
- make rebase and squash operations offline-capable ([b787976](https://github.com/jhleao/teapot/commit/b787976b11af8e374d5810c2ea3dd3231bf73ff7))
- only block Ship It for current branch when working tree is dirty ([2ba224d](https://github.com/jhleao/teapot/commit/2ba224da4ccb5fd867d06b1eb497b3c5d583da67))
- only show Rebase button for branches directly off trunk ([3aae231](https://github.com/jhleao/teapot/commit/3aae23152e013aeb7c19c301f6f7b86995cbb00a))
- only show rebase button on stack tails ([a0264ed](https://github.com/jhleao/teapot/commit/a0264ed8c995a7368ee4a46b2e87ebd57406a6f8))
- only show Ship button for branches directly off trunk ([7d110e6](https://github.com/jhleao/teapot/commit/7d110e6bdaed155c6e37d9ffa7a32e159a6e84e7))
- prevent collapsing commits that have dependent stacks (fork points) ([b6b8c86](https://github.com/jhleao/teapot/commit/b6b8c8679e7f040c6f02af1855e684b72966108a))
- prevent half-rebased UI state during long rebases ([45624bd](https://github.com/jhleao/teapot/commit/45624bd5ad79b2ff85d4488f7e2b3988cbb3ea6c))
- prevent lock queue chain breakage on error ([8f16a11](https://github.com/jhleao/teapot/commit/8f16a11a740ded98fc346d94064779c79f58a089))
- prevent race condition in rapid rebase operations ([2102d06](https://github.com/jhleao/teapot/commit/2102d063a028094a13c32102be3f4290e403921f))
- prevent sibling branches from being selected as PR targets ([d628d38](https://github.com/jhleao/teapot/commit/d628d38d7c19258a1f80bfde3160184c5cebbeac))
- prevent UI crash when UiStateContext accessed during error recovery ([6655d41](https://github.com/jhleao/teapot/commit/6655d41870e14a411f8c51ba900c883de1afb91b))
- rebase button logic on branchless stacks ([b5a2c91](https://github.com/jhleao/teapot/commit/b5a2c91a67867714e161dfec82930e2fdcf32b4d))
- resolve git directory correctly when operating from linked worktree ([d22c2ce](https://github.com/jhleao/teapot/commit/d22c2ce234d090c7ba5b27a519c296f63889dc71))
- restore dirty worktree indicator by enabling dirty check ([03cbf37](https://github.com/jhleao/teapot/commit/03cbf378cc0712aa4e465f39eaf3fcf1b682e2a6))
- return null from currentBranch() for detached HEAD state ([a0dae99](https://github.com/jhleao/teapot/commit/a0dae995e581b4de026a7a72a67358ea756c12b4))
- several git forge edge case fixes ([38aa261](https://github.com/jhleao/teapot/commit/38aa2614bf8ee9c26380bef07e5e83341ef7639f))
- show all owned commits in rebase preview ([7d0f89b](https://github.com/jhleao/teapot/commit/7d0f89bc4984e9f2b134aa38879f2aa689288882))
- show error dialog when branch deletion or cleanup fails ([7e724bf](https://github.com/jhleao/teapot/commit/7e724bf3f214253610b0feb7a585a1c46225d8de))
- show error instead of white screen when IPC hangs after wake ([5319d01](https://github.com/jhleao/teapot/commit/5319d016cc36026f3220fb67a78c8776128aaef9))
- show open PR instead of closed when multiple PRs exist for same branch ([2633c61](https://github.com/jhleao/teapot/commit/2633c619f30f8afe3a4d6d03a3ca627096ea3cd6))
- show Ship It button only on bottom branch of PR stack ([27d0de5](https://github.com/jhleao/teapot/commit/27d0de5faeb9b6d35ec3f4130eb245796196875b))
- stabilize branch cleanup ([85ce0cc](https://github.com/jhleao/teapot/commit/85ce0cc38d117b2a721ab06e636fb276b772b5f6))
- sync trunk without temporary worktrees ([77d5ca7](https://github.com/jhleao/teapot/commit/77d5ca75d5276d7f78aec093047d592a904820e5))
- update PR base branch when updating PR after rebase ([9301f85](https://github.com/jhleao/teapot/commit/9301f85e6ef927f2d30d9cf10ecfb419af6f5c24))
- use active worktree when rebase is in progress during continue ([c6f0e82](https://github.com/jhleao/teapot/commit/c6f0e822350035a641147d036058dedd04eac9d3))
- use opaque background for status checks dropdown ([e8ca943](https://github.com/jhleao/teapot/commit/e8ca943623cc9fa4455c03f89e9c41e973978d1c))

### Code Refactoring

- improve clone repository architecture and UX ([ac675af](https://github.com/jhleao/teapot/commit/ac675af7c0605a9dee1a3351fa45914d9f2f9a56))

### Documentation

- add architect review and implementation specs to idea 07 ([11ebe5e](https://github.com/jhleao/teapot/commit/11ebe5eff0bf6b7a1e95eed26773a3c8ea9f7a70))
- add ideas from worktree lifecycle and error handling post-mortems ([459fc89](https://github.com/jhleao/teapot/commit/459fc892ccefcc383fb08698b863c2ea8a90681f))
- consolidate legacy docs into actionable implementation ideas ([01dff97](https://github.com/jhleao/teapot/commit/01dff97378bee86f28ef064aa33a61d7a3bc4366))
- refine idea 02 with evidence and simpler design ([a33ae86](https://github.com/jhleao/teapot/commit/a33ae86324f9e6d04046dcbb917696241d0fd00f))
- remove GitHub webhooks idea doc ([8449868](https://github.com/jhleao/teapot/commit/8449868b6a0f2e25c01d17f40f1276a1bd443621))
- remove idea 08 (state immutability) - already addressed ([7ddf705](https://github.com/jhleao/teapot/commit/7ddf7052252a87c99b765e868081cc909d06bafc))
- remove stale GraphQL API idea (already implemented) ([0d2cd0b](https://github.com/jhleao/teapot/commit/0d2cd0bb35b165a802f8075d6da0e234fc51dfe2))
- remove stale rate limit handling idea ([c96d45d](https://github.com/jhleao/teapot/commit/c96d45d01bddce98b2e845118a7238850bc6a48d))
- revise idea 11 to comprehensive diagnostics service ([64301e9](https://github.com/jhleao/teapot/commit/64301e92a4e1bff40caf19fd33a8d769cd924d98))

## [0.7.0](https://github.com/jhleao/teapot/compare/v0.6.0...v0.7.0) (2026-01-04)

### Features

- add request versioning ([fc82f5d](https://github.com/jhleao/teapot/commit/fc82f5dfc6ba96fe2e9e66ca858d70173bf1d3cd))
- worktree context menu on app header ([9969bbc](https://github.com/jhleao/teapot/commit/9969bbc34b30eb3fc52a61dc84c437098a59ad97))

### Bug Fixes

- handle github pr eventual consistency ([1390f0c](https://github.com/jhleao/teapot/commit/1390f0ce5b3b2e4d4c1049185f6e3a58a957c0aa))
- optimize getRepo performance (substantially) ([a7b38d3](https://github.com/jhleao/teapot/commit/a7b38d3b5994cad3a74c8b9a5c6c8a8367c81138))

## [0.6.0](https://github.com/jhleao/teapot/compare/v0.5.0...v0.6.0) (2026-01-02)

### Features

- add configurable merge strategy with rebase default ([116d2d2](https://github.com/jhleao/teapot/commit/116d2d211234f6b5399fa56e55944491042cabf8))
- add context menu to copy commit SHA ([97f6909](https://github.com/jhleao/teapot/commit/97f6909c76c38d10a76ae2d516d6be076e449430))
- add loading state for rebase confirm button ([2c5fb84](https://github.com/jhleao/teapot/commit/2c5fb84d3fe3846f17601e104e98ca4b41e9e6b6))
- worktree support ([34c99ba](https://github.com/jhleao/teapot/commit/34c99ba9c687d2529242a1cc8143dd58179918a0))

### Bug Fixes

- rebase uses immediate parent as base, not fork point ([feac365](https://github.com/jhleao/teapot/commit/feac365ce22bd7816c5726dd408fabe4c7ad014a))

## [0.5.0](https://github.com/jhleao/teapot/compare/v0.4.1...v0.5.0) (2025-12-23)

### Features

- command+enter shortcut for committing ([67fb11d](https://github.com/jhleao/teapot/commit/67fb11d87cd57e5875d5d58facbd755787d9ffc6))
- restore git watcher functionality with rebase intent lock ([5a1538b](https://github.com/jhleao/teapot/commit/5a1538be76e039767985cd4133eae5e9ebdfcb28))
- uncommit loading state ([a9d6907](https://github.com/jhleao/teapot/commit/a9d690751b3ea2b63d96a47d09371a55adf29f41))

## [0.4.1](https://github.com/jhleao/teapot/compare/v0.4.0...v0.4.1) (2025-12-22)

### Bug Fixes

- temporary workaround for unsigned app ([2f8f875](https://github.com/jhleao/teapot/commit/2f8f875702e280fd254229b2137938a20d869f9e))

## [0.4.0](https://github.com/jhleao/teapot/compare/v0.3.1...v0.4.0) (2025-12-22)

### Features

- auto updater ([1e50258](https://github.com/jhleao/teapot/commit/1e502580d42534f8a34e59bd741ea672efd75fa1))

## [0.3.1](https://github.com/jhleao/teapot/compare/v0.3.0...v0.3.1) (2025-12-22)

### Bug Fixes

- release tagging ([1d99d92](https://github.com/jhleao/teapot/commit/1d99d923411c252c806e3aaae77b83e2dbe2f502))

## [0.3.0](https://github.com/jhleao/teapot/compare/v0.2.3...v0.3.0) (2025-12-22)

### Features

- ability to specify branch name ([#47](https://github.com/jhleao/teapot/issues/47)) ([a2ac455](https://github.com/jhleao/teapot/commit/a2ac4559b5294b2f8ffdec2313034396fe0def76))
- add configuration model ([de1d188](https://github.com/jhleao/teapot/commit/de1d1889157f7ce44758f999620f38eae972163b))
- add error toast ([#92](https://github.com/jhleao/teapot/issues/92)) ([de0a5a9](https://github.com/jhleao/teapot/commit/de0a5a99e8e4f2edef7edf42177c441d531aff33))
- add git pull button ([#146](https://github.com/jhleao/teapot/issues/146)) ([94bac92](https://github.com/jhleao/teapot/commit/94bac924e877f26b431a1cafc3d08b9ab71c21a9))
- amending ([#45](https://github.com/jhleao/teapot/issues/45)) ([e535650](https://github.com/jhleao/teapot/commit/e535650f1c2371324f784551d0c90f9d0dc244f7))
- basic ui components ([#14](https://github.com/jhleao/teapot/issues/14)) ([9f6228f](https://github.com/jhleao/teapot/commit/9f6228f9e3af511cfc148d9550fae37b652b4fad))
- branch context menu ([#46](https://github.com/jhleao/teapot/issues/46)) ([307aea5](https://github.com/jhleao/teapot/commit/307aea56c396f5481e15166d6a5651314f96e310))
- build and ci ([#145](https://github.com/jhleao/teapot/issues/145)) ([b88a1d5](https://github.com/jhleao/teapot/commit/b88a1d53e3f68d2f7c661ce8ef2ece174670bc22))
- build basic repo model ([d64656e](https://github.com/jhleao/teapot/commit/d64656e26b1747069e5451eaa96ca0c19acac18d))
- checkouts and discards ([#44](https://github.com/jhleao/teapot/issues/44)) ([b1c3dc1](https://github.com/jhleao/teapot/commit/b1c3dc132ca82d76b6dd4f7437e8344412165b6d))
- conflict ux overhaul ([#144](https://github.com/jhleao/teapot/issues/144)) ([6397c5a](https://github.com/jhleao/teapot/commit/6397c5af0fbe923066c983d75aa94d98889df63d))
- create branch button ([cea8616](https://github.com/jhleao/teapot/commit/cea86166178e0b08146b9b74988c647d58fbb5af))
- custom branch names ([#150](https://github.com/jhleao/teapot/issues/150)) ([c04edf0](https://github.com/jhleao/teapot/commit/c04edf0d511ec0608b1123ba210b55cb1e6d8c6b))
- drag and drop ([#19](https://github.com/jhleao/teapot/issues/19)) ([e94527f](https://github.com/jhleao/teapot/commit/e94527fb222c7b8b956489609d3f60794664a77d))
- drag ux improvements ([ee71d37](https://github.com/jhleao/teapot/commit/ee71d37b6b0be8f9472cfe269c2d06b013372308))
- force push pull request ([#93](https://github.com/jhleao/teapot/issues/93)) ([e2d692c](https://github.com/jhleao/teapot/commit/e2d692c7e4e7900f75250621dec29056cb3d51ea))
- github integration ([#50](https://github.com/jhleao/teapot/issues/50)) ([20cd50a](https://github.com/jhleao/teapot/commit/20cd50abaebec79fdcbda7ac43ded0ba4a862624))
- implement dnd mouse events ([#26](https://github.com/jhleao/teapot/issues/26)) ([f570233](https://github.com/jhleao/teapot/commit/f57023342cf9c8e1eb48d30797a3a1389991abcb))
- improve 2d scrolling in the main screen ([a63ca32](https://github.com/jhleao/teapot/commit/a63ca32dc3789c1880ddac04a3e6fd42d9ff2754))
- improve models ([9ed661e](https://github.com/jhleao/teapot/commit/9ed661e5610bafae9c7bba7d3ca0769db1491017))
- improve rebase ux ([25af653](https://github.com/jhleao/teapot/commit/25af6534ec3e5b0a3c091964e84891d581b23d0f))
- overhaul drag ux ([#151](https://github.com/jhleao/teapot/issues/151)) ([b6c4a47](https://github.com/jhleao/teapot/commit/b6c4a47dc9b37358dc52593957463a1cd346d117))
- rebase children when amending ([#96](https://github.com/jhleao/teapot/issues/96)) ([19af900](https://github.com/jhleao/teapot/commit/19af900fac25aeb999e6788329157aa42477022f))
- rebase queue overhaul and crash recovery ([c1a8ca5](https://github.com/jhleao/teapot/commit/c1a8ca5816ad029c583fcf3b140f3723d28e9855))
- refactor ui state and working tree components ([#23](https://github.com/jhleao/teapot/issues/23)) ([a184d23](https://github.com/jhleao/teapot/commit/a184d23ea0a1477d92370e346780f75f0ce0eee6))
- rename branch ([efc08a6](https://github.com/jhleao/teapot/commit/efc08a68435df6a1e57b7a6cf0e9cd77145db5ff))
- repo caching ([#153](https://github.com/jhleao/teapot/issues/153)) ([832119e](https://github.com/jhleao/teapot/commit/832119e9bb229db2ad6693f0d58927c810400af7))
- repo onboarding and selection ([#36](https://github.com/jhleao/teapot/issues/36)) ([276f03e](https://github.com/jhleao/teapot/commit/276f03e01aa546a08f185dafca23a1a84844ac2e))
- repo switch loading state ([d591596](https://github.com/jhleao/teapot/commit/d591596e740ce834aa9cf9aecf828368718036b3))
- simplify smart checkout ([2c429f7](https://github.com/jhleao/teapot/commit/2c429f77c18e353cc409c2c30484b302a5532bcc))
- stage loading state ([58fe4f7](https://github.com/jhleao/teapot/commit/58fe4f7beb573ec58e5f47587fb65f057f6b464c))
- stages and commits ([#43](https://github.com/jhleao/teapot/issues/43)) ([29e0f93](https://github.com/jhleao/teapot/commit/29e0f93e6e190595d00bed46e940cc05dbb0d617))
- stub for committing ([#32](https://github.com/jhleao/teapot/issues/32)) ([c20962c](https://github.com/jhleao/teapot/commit/c20962c9d19288220c0272c11281a87937079dae))
- stub for rebase confirmation ([#31](https://github.com/jhleao/teapot/issues/31)) ([5202cc9](https://github.com/jhleao/teapot/commit/5202cc9d0c8274979d2e58ceca14a7e772fb4c65))
- stylized menu bar ([#37](https://github.com/jhleao/teapot/issues/37)) ([994e1c3](https://github.com/jhleao/teapot/commit/994e1c30977dda0d5ac859bc7a6317dbf7161402))
- stylized theme button ([#39](https://github.com/jhleao/teapot/issues/39)) ([11b6b1b](https://github.com/jhleao/teapot/commit/11b6b1b33d43fd0461b86a8123a94d306c786ef8))
- ui models and mocking ([#13](https://github.com/jhleao/teapot/issues/13)) ([cde3150](https://github.com/jhleao/teapot/commit/cde3150c3d2772348b51cd0ce26a87a8b250996c))
- uncommit and close PR ([#51](https://github.com/jhleao/teapot/issues/51)) ([c0b4caf](https://github.com/jhleao/teapot/commit/c0b4caf5b499c82fce96b7629fd8854e1b268cf6))
- use semantic colors ([#18](https://github.com/jhleao/teapot/issues/18)) ([582ec99](https://github.com/jhleao/teapot/commit/582ec99bffeaccb54a13321adbf081e30b09c34f))
- watch for file changes and update tree ([#42](https://github.com/jhleao/teapot/issues/42)) ([f023090](https://github.com/jhleao/teapot/commit/f0230905bff710e30fcde75b72c55de47e72845e))

### Bug Fixes

- asynchronous ipc methods ([#24](https://github.com/jhleao/teapot/issues/24)) ([7c262e8](https://github.com/jhleao/teapot/commit/7c262e8cd1c769a00e2fffb924df587295973e42))
- declutterTrunk logic on large repos ([662c048](https://github.com/jhleao/teapot/commit/662c0483b55c02f48a2655a995ff9ea6694b3eed))
- default to declutterTrunk ([#94](https://github.com/jhleao/teapot/issues/94)) ([6e47b60](https://github.com/jhleao/teapot/commit/6e47b60cc919a009033ec4c431100edd42ad9a5b))
- drag and drop flickering ([#40](https://github.com/jhleao/teapot/issues/40)) ([8898eab](https://github.com/jhleao/teapot/commit/8898eabc2f980afd77f91b99630733e884b61112))
- force release ([1052d71](https://github.com/jhleao/teapot/commit/1052d718e00d497d09be7e92b14b8cc35e8eb207))
- force release ([c54bc78](https://github.com/jhleao/teapot/commit/c54bc78d8268ec44143385b587c429612e68e09a))
- invalid repository handling ([#49](https://github.com/jhleao/teapot/issues/49)) ([b8d1f8c](https://github.com/jhleao/teapot/commit/b8d1f8ca819487fe426e159e8941e5cde42f0a53))
- parallel file staging ([#95](https://github.com/jhleao/teapot/issues/95)) ([d89dde6](https://github.com/jhleao/teapot/commit/d89dde6188f5b3f24a693e081dae1a5f23c69a90))
- performance issues on dragging ([6713957](https://github.com/jhleao/teapot/commit/6713957ad09464785745ae9fb579d307310608cd))
- prevent rebasing with child ([7b2cd97](https://github.com/jhleao/teapot/commit/7b2cd97b217278b165f5185c62118a3b62440fee))
- refresh forge state on pr update ([88336ed](https://github.com/jhleao/teapot/commit/88336ed346e920584e1f279ded7a7cabc5d3559b))
- release tagging schema ([fc8c7bf](https://github.com/jhleao/teapot/commit/fc8c7bfe6361568ce39de5b41224d1e69bd43a7c))
- render sibling spinoffs ([#17](https://github.com/jhleao/teapot/issues/17)) ([4b0a3c5](https://github.com/jhleao/teapot/commit/4b0a3c5a9eb1fa6a0e037d151bbbeece1b22e69a))
- typedefs for ipc handlers ([#33](https://github.com/jhleao/teapot/issues/33)) ([632b10c](https://github.com/jhleao/teapot/commit/632b10c59d6e5d5f4ea15a8dfcdf78f9e0f23d57))
- vitest config ([#27](https://github.com/jhleao/teapot/issues/27)) ([e57cb48](https://github.com/jhleao/teapot/commit/e57cb48c92713dcfd04e0e5b1c9c212a524197b3))

### Performance

- react memoization ([#154](https://github.com/jhleao/teapot/issues/154)) ([cfe440b](https://github.com/jhleao/teapot/commit/cfe440b695668ab222b6abd04d0975234b52a307))

### Code Refactoring

- extract util ([382c7fd](https://github.com/jhleao/teapot/commit/382c7fd07f8682c2f10e6dc3924e328cdd41214b))
- introduce shared ipc contract ([#25](https://github.com/jhleao/teapot/issues/25)) ([794a55b](https://github.com/jhleao/teapot/commit/794a55bb34a7fa457a0b9bd7a0ce18d07d9cbfa6))

## [0.2.3](https://github.com/jhleao/teapot/compare/teapot-v0.2.2...teapot-v0.2.3) (2025-12-22)

### Bug Fixes

- force release ([1052d71](https://github.com/jhleao/teapot/commit/1052d718e00d497d09be7e92b14b8cc35e8eb207))

## [0.2.2](https://github.com/jhleao/teapot/compare/teapot-v0.2.1...teapot-v0.2.2) (2025-12-22)

### Bug Fixes

- force release ([c54bc78](https://github.com/jhleao/teapot/commit/c54bc78d8268ec44143385b587c429612e68e09a))

## [0.2.1](https://github.com/jhleao/teapot/compare/teapot-v0.2.0...teapot-v0.2.1) (2025-12-22)

### Bug Fixes

- refresh forge state on pr update ([88336ed](https://github.com/jhleao/teapot/commit/88336ed346e920584e1f279ded7a7cabc5d3559b))

## [0.2.0](https://github.com/jhleao/teapot/compare/teapot-v0.1.0...teapot-v0.2.0) (2025-12-22)

### Features

- ability to specify branch name ([#47](https://github.com/jhleao/teapot/issues/47)) ([a2ac455](https://github.com/jhleao/teapot/commit/a2ac4559b5294b2f8ffdec2313034396fe0def76))
- add configuration model ([de1d188](https://github.com/jhleao/teapot/commit/de1d1889157f7ce44758f999620f38eae972163b))
- add error toast ([#92](https://github.com/jhleao/teapot/issues/92)) ([de0a5a9](https://github.com/jhleao/teapot/commit/de0a5a99e8e4f2edef7edf42177c441d531aff33))
- add git pull button ([#146](https://github.com/jhleao/teapot/issues/146)) ([94bac92](https://github.com/jhleao/teapot/commit/94bac924e877f26b431a1cafc3d08b9ab71c21a9))
- amending ([#45](https://github.com/jhleao/teapot/issues/45)) ([e535650](https://github.com/jhleao/teapot/commit/e535650f1c2371324f784551d0c90f9d0dc244f7))
- basic ui components ([#14](https://github.com/jhleao/teapot/issues/14)) ([9f6228f](https://github.com/jhleao/teapot/commit/9f6228f9e3af511cfc148d9550fae37b652b4fad))
- branch context menu ([#46](https://github.com/jhleao/teapot/issues/46)) ([307aea5](https://github.com/jhleao/teapot/commit/307aea56c396f5481e15166d6a5651314f96e310))
- build and ci ([#145](https://github.com/jhleao/teapot/issues/145)) ([b88a1d5](https://github.com/jhleao/teapot/commit/b88a1d53e3f68d2f7c661ce8ef2ece174670bc22))
- build basic repo model ([d64656e](https://github.com/jhleao/teapot/commit/d64656e26b1747069e5451eaa96ca0c19acac18d))
- checkouts and discards ([#44](https://github.com/jhleao/teapot/issues/44)) ([b1c3dc1](https://github.com/jhleao/teapot/commit/b1c3dc132ca82d76b6dd4f7437e8344412165b6d))
- conflict ux overhaul ([#144](https://github.com/jhleao/teapot/issues/144)) ([6397c5a](https://github.com/jhleao/teapot/commit/6397c5af0fbe923066c983d75aa94d98889df63d))
- create branch button ([cea8616](https://github.com/jhleao/teapot/commit/cea86166178e0b08146b9b74988c647d58fbb5af))
- custom branch names ([#150](https://github.com/jhleao/teapot/issues/150)) ([c04edf0](https://github.com/jhleao/teapot/commit/c04edf0d511ec0608b1123ba210b55cb1e6d8c6b))
- drag and drop ([#19](https://github.com/jhleao/teapot/issues/19)) ([e94527f](https://github.com/jhleao/teapot/commit/e94527fb222c7b8b956489609d3f60794664a77d))
- drag ux improvements ([ee71d37](https://github.com/jhleao/teapot/commit/ee71d37b6b0be8f9472cfe269c2d06b013372308))
- force push pull request ([#93](https://github.com/jhleao/teapot/issues/93)) ([e2d692c](https://github.com/jhleao/teapot/commit/e2d692c7e4e7900f75250621dec29056cb3d51ea))
- github integration ([#50](https://github.com/jhleao/teapot/issues/50)) ([20cd50a](https://github.com/jhleao/teapot/commit/20cd50abaebec79fdcbda7ac43ded0ba4a862624))
- implement dnd mouse events ([#26](https://github.com/jhleao/teapot/issues/26)) ([f570233](https://github.com/jhleao/teapot/commit/f57023342cf9c8e1eb48d30797a3a1389991abcb))
- improve 2d scrolling in the main screen ([a63ca32](https://github.com/jhleao/teapot/commit/a63ca32dc3789c1880ddac04a3e6fd42d9ff2754))
- improve models ([9ed661e](https://github.com/jhleao/teapot/commit/9ed661e5610bafae9c7bba7d3ca0769db1491017))
- improve rebase ux ([25af653](https://github.com/jhleao/teapot/commit/25af6534ec3e5b0a3c091964e84891d581b23d0f))
- overhaul drag ux ([#151](https://github.com/jhleao/teapot/issues/151)) ([b6c4a47](https://github.com/jhleao/teapot/commit/b6c4a47dc9b37358dc52593957463a1cd346d117))
- rebase children when amending ([#96](https://github.com/jhleao/teapot/issues/96)) ([19af900](https://github.com/jhleao/teapot/commit/19af900fac25aeb999e6788329157aa42477022f))
- rebase queue overhaul and crash recovery ([c1a8ca5](https://github.com/jhleao/teapot/commit/c1a8ca5816ad029c583fcf3b140f3723d28e9855))
- refactor ui state and working tree components ([#23](https://github.com/jhleao/teapot/issues/23)) ([a184d23](https://github.com/jhleao/teapot/commit/a184d23ea0a1477d92370e346780f75f0ce0eee6))
- rename branch ([efc08a6](https://github.com/jhleao/teapot/commit/efc08a68435df6a1e57b7a6cf0e9cd77145db5ff))
- repo caching ([#153](https://github.com/jhleao/teapot/issues/153)) ([832119e](https://github.com/jhleao/teapot/commit/832119e9bb229db2ad6693f0d58927c810400af7))
- repo onboarding and selection ([#36](https://github.com/jhleao/teapot/issues/36)) ([276f03e](https://github.com/jhleao/teapot/commit/276f03e01aa546a08f185dafca23a1a84844ac2e))
- repo switch loading state ([d591596](https://github.com/jhleao/teapot/commit/d591596e740ce834aa9cf9aecf828368718036b3))
- simplify smart checkout ([2c429f7](https://github.com/jhleao/teapot/commit/2c429f77c18e353cc409c2c30484b302a5532bcc))
- stage loading state ([58fe4f7](https://github.com/jhleao/teapot/commit/58fe4f7beb573ec58e5f47587fb65f057f6b464c))
- stages and commits ([#43](https://github.com/jhleao/teapot/issues/43)) ([29e0f93](https://github.com/jhleao/teapot/commit/29e0f93e6e190595d00bed46e940cc05dbb0d617))
- stub for committing ([#32](https://github.com/jhleao/teapot/issues/32)) ([c20962c](https://github.com/jhleao/teapot/commit/c20962c9d19288220c0272c11281a87937079dae))
- stub for rebase confirmation ([#31](https://github.com/jhleao/teapot/issues/31)) ([5202cc9](https://github.com/jhleao/teapot/commit/5202cc9d0c8274979d2e58ceca14a7e772fb4c65))
- stylized menu bar ([#37](https://github.com/jhleao/teapot/issues/37)) ([994e1c3](https://github.com/jhleao/teapot/commit/994e1c30977dda0d5ac859bc7a6317dbf7161402))
- stylized theme button ([#39](https://github.com/jhleao/teapot/issues/39)) ([11b6b1b](https://github.com/jhleao/teapot/commit/11b6b1b33d43fd0461b86a8123a94d306c786ef8))
- ui models and mocking ([#13](https://github.com/jhleao/teapot/issues/13)) ([cde3150](https://github.com/jhleao/teapot/commit/cde3150c3d2772348b51cd0ce26a87a8b250996c))
- uncommit and close PR ([#51](https://github.com/jhleao/teapot/issues/51)) ([c0b4caf](https://github.com/jhleao/teapot/commit/c0b4caf5b499c82fce96b7629fd8854e1b268cf6))
- use semantic colors ([#18](https://github.com/jhleao/teapot/issues/18)) ([582ec99](https://github.com/jhleao/teapot/commit/582ec99bffeaccb54a13321adbf081e30b09c34f))
- watch for file changes and update tree ([#42](https://github.com/jhleao/teapot/issues/42)) ([f023090](https://github.com/jhleao/teapot/commit/f0230905bff710e30fcde75b72c55de47e72845e))

### Bug Fixes

- asynchronous ipc methods ([#24](https://github.com/jhleao/teapot/issues/24)) ([7c262e8](https://github.com/jhleao/teapot/commit/7c262e8cd1c769a00e2fffb924df587295973e42))
- declutterTrunk logic on large repos ([662c048](https://github.com/jhleao/teapot/commit/662c0483b55c02f48a2655a995ff9ea6694b3eed))
- default to declutterTrunk ([#94](https://github.com/jhleao/teapot/issues/94)) ([6e47b60](https://github.com/jhleao/teapot/commit/6e47b60cc919a009033ec4c431100edd42ad9a5b))
- drag and drop flickering ([#40](https://github.com/jhleao/teapot/issues/40)) ([8898eab](https://github.com/jhleao/teapot/commit/8898eabc2f980afd77f91b99630733e884b61112))
- invalid repository handling ([#49](https://github.com/jhleao/teapot/issues/49)) ([b8d1f8c](https://github.com/jhleao/teapot/commit/b8d1f8ca819487fe426e159e8941e5cde42f0a53))
- parallel file staging ([#95](https://github.com/jhleao/teapot/issues/95)) ([d89dde6](https://github.com/jhleao/teapot/commit/d89dde6188f5b3f24a693e081dae1a5f23c69a90))
- performance issues on dragging ([6713957](https://github.com/jhleao/teapot/commit/6713957ad09464785745ae9fb579d307310608cd))
- prevent rebasing with child ([7b2cd97](https://github.com/jhleao/teapot/commit/7b2cd97b217278b165f5185c62118a3b62440fee))
- render sibling spinoffs ([#17](https://github.com/jhleao/teapot/issues/17)) ([4b0a3c5](https://github.com/jhleao/teapot/commit/4b0a3c5a9eb1fa6a0e037d151bbbeece1b22e69a))
- typedefs for ipc handlers ([#33](https://github.com/jhleao/teapot/issues/33)) ([632b10c](https://github.com/jhleao/teapot/commit/632b10c59d6e5d5f4ea15a8dfcdf78f9e0f23d57))
- vitest config ([#27](https://github.com/jhleao/teapot/issues/27)) ([e57cb48](https://github.com/jhleao/teapot/commit/e57cb48c92713dcfd04e0e5b1c9c212a524197b3))

### Performance

- react memoization ([#154](https://github.com/jhleao/teapot/issues/154)) ([cfe440b](https://github.com/jhleao/teapot/commit/cfe440b695668ab222b6abd04d0975234b52a307))

### Code Refactoring

- extract util ([382c7fd](https://github.com/jhleao/teapot/commit/382c7fd07f8682c2f10e6dc3924e328cdd41214b))
- introduce shared ipc contract ([#25](https://github.com/jhleao/teapot/issues/25)) ([794a55b](https://github.com/jhleao/teapot/commit/794a55bb34a7fa457a0b9bd7a0ce18d07d9cbfa6))
