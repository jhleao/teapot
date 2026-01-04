# Changelog

## [0.7.0](https://github.com/jhleao/teapot/compare/v0.6.0...v0.7.0) (2026-01-04)


### Features

* add request versioning ([fc82f5d](https://github.com/jhleao/teapot/commit/fc82f5dfc6ba96fe2e9e66ca858d70173bf1d3cd))
* worktree context menu on app header ([9969bbc](https://github.com/jhleao/teapot/commit/9969bbc34b30eb3fc52a61dc84c437098a59ad97))


### Bug Fixes

* handle github pr eventual consistency ([1390f0c](https://github.com/jhleao/teapot/commit/1390f0ce5b3b2e4d4c1049185f6e3a58a957c0aa))
* optimize getRepo performance (substantially) ([a7b38d3](https://github.com/jhleao/teapot/commit/a7b38d3b5994cad3a74c8b9a5c6c8a8367c81138))

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
