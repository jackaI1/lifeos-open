# Third-party notices

Audit snapshot: 2026-10-19. MIT applies to original LifeOS code and authored demo assets; upstream components retain the terms below. This inventory includes every package-lock.json entry, including optional platform binaries. Installed metadata and license files were checked after fresh npm ci; absent platform packages were checked against exact-version npm registry metadata. React view dependencies (React, React DOM, Vitest, jsdom, Testing Library and their transitive packages) were added on 2026-11-03 with the same method.

## Runtime dependencies

The local retrieval store adds `sqlite-vec` 0.1.9 and its optional platform
packages, all under `MIT OR Apache` according to their package metadata. I use
the MIT option; its [preserved terms](public/vendor/licenses/npm/sqlite-vec/LICENSE-MIT)
come from the [v0.1.9 source](https://github.com/asg017/sqlite-vec/tree/v0.1.9).

| Component | Version | License / class | Source | Preserved terms |
|---|---|---|---|---|
| @tiptap/core | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/core/LICENSE.md) |
| @tiptap/extension-blockquote | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-blockquote/LICENSE.md) |
| @tiptap/extension-bold | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-bold/LICENSE.md) |
| @tiptap/extension-bullet-list | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-bullet-list/LICENSE.md) |
| @tiptap/extension-code | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-code/LICENSE.md) |
| @tiptap/extension-code-block | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-code-block/LICENSE.md) |
| @tiptap/extension-document | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-document/LICENSE.md) |
| @tiptap/extension-dropcursor | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-dropcursor/LICENSE.md) |
| @tiptap/extension-gapcursor | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-gapcursor/LICENSE.md) |
| @tiptap/extension-hard-break | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-hard-break/LICENSE.md) |
| @tiptap/extension-heading | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-heading/LICENSE.md) |
| @tiptap/extension-highlight | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-highlight/LICENSE.md) |
| @tiptap/extension-horizontal-rule | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-horizontal-rule/LICENSE.md) |
| @tiptap/extension-italic | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-italic/LICENSE.md) |
| @tiptap/extension-link | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-link/LICENSE.md) |
| @tiptap/extension-list | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-list/LICENSE.md) |
| @tiptap/extension-list-item | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-list-item/LICENSE.md) |
| @tiptap/extension-list-keymap | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-list-keymap/LICENSE.md) |
| @tiptap/extension-ordered-list | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-ordered-list/LICENSE.md) |
| @tiptap/extension-paragraph | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-paragraph/LICENSE.md) |
| @tiptap/extension-strike | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-strike/LICENSE.md) |
| @tiptap/extension-table | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-table/LICENSE.md) |
| @tiptap/extension-task-item | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-task-item/LICENSE.md) |
| @tiptap/extension-task-list | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-task-list/LICENSE.md) |
| @tiptap/extension-text | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-text/LICENSE.md) |
| @tiptap/extension-text-align | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-text-align/LICENSE.md) |
| @tiptap/extension-text-style | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-text-style/LICENSE.md) |
| @tiptap/extension-underline | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extension-underline/LICENSE.md) |
| @tiptap/extensions | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/extensions/LICENSE.md) |
| @tiptap/pm | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE](public/vendor/licenses/npm/@tiptap/pm/LICENSE) |
| @tiptap/starter-kit | 3.31.3 | MIT / permissive | [upstream](https://tiptap.dev) | [LICENSE.md](public/vendor/licenses/npm/@tiptap/starter-kit/LICENSE.md) |
| agent-base | 7.1.4 | MIT / permissive | [upstream](https://www.npmjs.com/package/agent-base/v/7.1.4) | [LICENSE](public/vendor/licenses/npm/agent-base/LICENSE) |
| asn1.js | 5.4.1 | MIT / permissive | [upstream](https://github.com/indutny/asn1.js) | [LICENSE](public/vendor/licenses/npm/asn1.js/LICENSE) |
| base64-js | 1.5.1 | MIT / permissive | [upstream](https://github.com/beatgammit/base64-js) | [LICENSE](public/vendor/licenses/npm/base64-js/LICENSE) |
| bignumber.js | 9.3.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/bignumber.js/v/9.3.1) | [LICENCE.md](public/vendor/licenses/npm/bignumber.js/LICENCE.md) |
| bn.js | 4.12.5 | MIT / permissive | [upstream](https://github.com/indutny/bn.js) | [LICENSE](public/vendor/licenses/npm/bn.js/LICENSE) |
| buffer-equal-constant-time | 1.0.1 | BSD-3-Clause / permissive | [upstream](https://www.npmjs.com/package/buffer-equal-constant-time/v/1.0.1) | [LICENSE.txt](public/vendor/licenses/npm/buffer-equal-constant-time/LICENSE.txt) |
| data-uri-to-buffer | 4.0.1 | MIT / permissive | [upstream](https://github.com/TooTallNate/node-data-uri-to-buffer) | [README.md](public/vendor/licenses/npm/data-uri-to-buffer/README.md) |
| debug | 4.4.3 | MIT / permissive | [upstream](https://www.npmjs.com/package/debug/v/4.4.3) | [LICENSE](public/vendor/licenses/npm/debug/LICENSE) |
| ecdsa-sig-formatter | 1.0.11 | Apache-2.0 / permissive | [upstream](https://github.com/Brightspace/node-ecdsa-sig-formatter#readme) | [LICENSE](public/vendor/licenses/npm/ecdsa-sig-formatter/LICENSE) |
| extend | 3.0.2 | MIT / permissive | [upstream](https://www.npmjs.com/package/extend/v/3.0.2) | [LICENSE](public/vendor/licenses/npm/extend/LICENSE) |
| fetch-blob | 3.2.0 | MIT / permissive | [upstream](https://github.com/node-fetch/fetch-blob#readme) | [LICENSE](public/vendor/licenses/npm/fetch-blob/LICENSE) |
| formdata-polyfill | 4.0.10 | MIT / permissive | [upstream](https://github.com/jimmywarting/FormData#readme) | [LICENSE](public/vendor/licenses/npm/formdata-polyfill/LICENSE) |
| gaxios | 7.3.1 | Apache-2.0 / permissive | [upstream](https://github.com/googleapis/google-cloud-node/tree/main/core/packages/gaxios) | [LICENSE](public/vendor/licenses/npm/gaxios/LICENSE) |
| gcp-metadata | 9.2.1 | Apache-2.0 / permissive | [upstream](https://github.com/googleapis/google-cloud-node/tree/main/core/packages/gcp-metadata) | [LICENSE](public/vendor/licenses/npm/gcp-metadata/LICENSE) |
| gaxios | 8.3.1 | Apache-2.0 / permissive | [upstream](https://github.com/googleapis/google-cloud-node/tree/main/core/packages/gaxios) | [LICENSE](public/vendor/licenses/npm/gaxios/LICENSE) |
| google-auth-library | 11.0.2 | Apache-2.0 / permissive | [upstream](https://github.com/googleapis/google-cloud-node/tree/main/core/packages/google-auth-library-nodejs) | [LICENSE](public/vendor/licenses/npm/google-auth-library/LICENSE) |
| google-logging-utils | 2.1.0 | Apache-2.0 / permissive | [upstream](https://github.com/googleapis/google-cloud-node/tree/main/core/packages/logging-utils) | [LICENSE](public/vendor/licenses/npm/google-logging-utils/LICENSE) |
| http_ece | 1.2.0 | MIT / permissive | [upstream](https://github.com/martinthomson/encrypted-content-encoding) | [LICENSE.upstream](public/vendor/licenses/npm/http_ece/LICENSE.upstream), [README.md](public/vendor/licenses/npm/http_ece/README.md) |
| https-proxy-agent | 7.0.6 | MIT / permissive | [upstream](https://www.npmjs.com/package/https-proxy-agent/v/7.0.6) | [LICENSE](public/vendor/licenses/npm/https-proxy-agent/LICENSE) |
| inherits | 2.0.4 | ISC / permissive | [upstream](https://www.npmjs.com/package/inherits/v/2.0.4) | [LICENSE](public/vendor/licenses/npm/inherits/LICENSE) |
| json-bigint | 1.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/json-bigint/v/1.0.0) | [LICENSE](public/vendor/licenses/npm/json-bigint/LICENSE) |
| jwa | 2.0.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/jwa/v/2.0.1) | [LICENSE](public/vendor/licenses/npm/jwa/LICENSE) |
| jws | 4.0.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/jws/v/4.0.1) | [LICENSE](public/vendor/licenses/npm/jws/LICENSE) |
| linkifyjs | 4.3.3 | MIT / permissive | [upstream](https://linkify.js.org) | [LICENSE](public/vendor/licenses/npm/linkifyjs/LICENSE) |
| minimalistic-assert | 1.0.1 | ISC / permissive | [upstream](https://github.com/calvinmetcalf/minimalistic-assert) | [LICENSE](public/vendor/licenses/npm/minimalistic-assert/LICENSE) |
| minimist | 1.2.8 | MIT / permissive | [upstream](https://github.com/minimistjs/minimist) | [LICENSE](public/vendor/licenses/npm/minimist/LICENSE) |
| ms | 2.1.3 | MIT / permissive | [upstream](https://www.npmjs.com/package/ms/v/2.1.3) | [license.md](public/vendor/licenses/npm/ms/license.md) |
| node-domexception | 1.0.0 | MIT / permissive | [upstream](https://github.com/jimmywarting/node-domexception#readme) | [LICENSE](public/vendor/licenses/npm/node-domexception/LICENSE) |
| node-fetch | 3.3.2 | MIT / permissive | [upstream](https://github.com/node-fetch/node-fetch) | [LICENSE.md](public/vendor/licenses/npm/node-fetch/LICENSE.md) |
| orderedmap | 2.1.1 | MIT / permissive | [upstream](https://github.com/marijnh/orderedmap#readme) | [LICENSE](public/vendor/licenses/npm/orderedmap/LICENSE) |
| prosemirror-changeset | 2.4.4 | MIT / permissive | [upstream](https://www.npmjs.com/package/prosemirror-changeset/v/2.4.4) | [LICENSE](public/vendor/licenses/npm/prosemirror-changeset/LICENSE) |
| prosemirror-commands | 1.7.2 | MIT / permissive | [upstream](https://www.npmjs.com/package/prosemirror-commands/v/1.7.2) | [LICENSE](public/vendor/licenses/npm/prosemirror-commands/LICENSE) |
| prosemirror-dropcursor | 1.8.4 | MIT / permissive | [upstream](https://www.npmjs.com/package/prosemirror-dropcursor/v/1.8.4) | [LICENSE](public/vendor/licenses/npm/prosemirror-dropcursor/LICENSE) |
| prosemirror-gapcursor | 1.4.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/prosemirror-gapcursor/v/1.4.1) | [LICENSE](public/vendor/licenses/npm/prosemirror-gapcursor/LICENSE) |
| prosemirror-history | 1.5.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/prosemirror-history/v/1.5.1) | [LICENSE](public/vendor/licenses/npm/prosemirror-history/LICENSE) |
| prosemirror-inputrules | 1.5.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/prosemirror-inputrules/v/1.5.1) | [LICENSE](public/vendor/licenses/npm/prosemirror-inputrules/LICENSE) |
| prosemirror-keymap | 1.2.3 | MIT / permissive | [upstream](https://www.npmjs.com/package/prosemirror-keymap/v/1.2.3) | [LICENSE](public/vendor/licenses/npm/prosemirror-keymap/LICENSE) |
| prosemirror-model | 1.25.12 | MIT / permissive | [upstream](https://www.npmjs.com/package/prosemirror-model/v/1.25.12) | [LICENSE](public/vendor/licenses/npm/prosemirror-model/LICENSE) |
| prosemirror-schema-list | 1.5.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/prosemirror-schema-list/v/1.5.1) | [LICENSE](public/vendor/licenses/npm/prosemirror-schema-list/LICENSE) |
| prosemirror-state | 1.4.4 | MIT / permissive | [upstream](https://www.npmjs.com/package/prosemirror-state/v/1.4.4) | [LICENSE](public/vendor/licenses/npm/prosemirror-state/LICENSE) |
| prosemirror-tables | 1.8.5 | MIT / permissive | [upstream](https://www.npmjs.com/package/prosemirror-tables/v/1.8.5) | [LICENSE](public/vendor/licenses/npm/prosemirror-tables/LICENSE) |
| prosemirror-transform | 1.12.2 | MIT / permissive | [upstream](https://www.npmjs.com/package/prosemirror-transform/v/1.12.2) | [LICENSE](public/vendor/licenses/npm/prosemirror-transform/LICENSE) |
| prosemirror-view | 1.42.6 | MIT / permissive | [upstream](https://www.npmjs.com/package/prosemirror-view/v/1.42.6) | [LICENSE](public/vendor/licenses/npm/prosemirror-view/LICENSE) |
| rope-sequence | 1.3.4 | MIT / permissive | [upstream](https://www.npmjs.com/package/rope-sequence/v/1.3.4) | [LICENSE](public/vendor/licenses/npm/rope-sequence/LICENSE) |
| safe-buffer | 5.2.1 | MIT / permissive | [upstream](https://github.com/feross/safe-buffer) | [LICENSE](public/vendor/licenses/npm/safe-buffer/LICENSE) |
| safer-buffer | 2.1.2 | MIT / permissive | [upstream](https://www.npmjs.com/package/safer-buffer/v/2.1.2) | [LICENSE](public/vendor/licenses/npm/safer-buffer/LICENSE) |
| w3c-keyname | 2.2.8 | MIT / permissive | [upstream](https://github.com/marijnh/w3c-keyname#readme) | [LICENSE](public/vendor/licenses/npm/w3c-keyname/LICENSE) |
| web-push | 3.6.7 | MPL-2.0 / weak copyleft | [upstream](https://github.com/web-push-libs/web-push#readme) | [LICENSE](public/vendor/licenses/npm/web-push/LICENSE) |
| web-streams-polyfill | 3.3.3 | MIT / permissive | [upstream](https://github.com/MattiasBuelens/web-streams-polyfill#readme) | [LICENSE](public/vendor/licenses/npm/web-streams-polyfill/LICENSE) |
| react | 19.3.1 | MIT / permissive | [upstream](https://react.dev/) | [LICENSE](public/vendor/licenses/npm/react/LICENSE) |
| react-dom | 19.3.1 | MIT / permissive | [upstream](https://react.dev/) | [LICENSE](public/vendor/licenses/npm/react-dom/LICENSE) |
| scheduler | 0.28.0 | MIT / permissive | [upstream](https://react.dev/) | [LICENSE](public/vendor/licenses/npm/scheduler/LICENSE) |

## Development and tests only

| Component | Version | License / class | Source | Preserved terms |
|---|---|---|---|---|
| @esbuild/aix-ppc64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/android-arm | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/android-arm64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/android-x64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/darwin-arm64 | 0.28.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/@esbuild/darwin-arm64/v/0.28.1) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/darwin-x64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/freebsd-arm64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/freebsd-x64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/linux-arm | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/linux-arm64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/linux-ia32 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/linux-loong64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/linux-mips64el | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/linux-ppc64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/linux-riscv64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/linux-s390x | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/linux-x64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/netbsd-arm64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/netbsd-x64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/openbsd-arm64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/openbsd-x64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/openharmony-arm64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/sunos-x64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/win32-arm64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/win32-ia32 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @esbuild/win32-x64 | 0.28.1 | MIT / permissive | [upstream](https://github.com/evanw/esbuild#readme) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| @eslint-community/eslint-utils | 4.10.1 | MIT / permissive | [upstream](https://github.com/eslint-community/eslint-utils#readme) | [LICENSE](public/vendor/licenses/npm/@eslint-community/eslint-utils/LICENSE) |
| eslint-visitor-keys | 3.4.3 | Apache-2.0 / permissive | [upstream](https://github.com/eslint/eslint-visitor-keys#readme) | [LICENSE](public/vendor/licenses/npm/eslint-visitor-keys/LICENSE) |
| @eslint-community/regexpp | 4.12.2 | MIT / permissive | [upstream](https://github.com/eslint-community/regexpp#readme) | [LICENSE](public/vendor/licenses/npm/@eslint-community/regexpp/LICENSE) |
| @eslint/config-array | 0.21.2 | Apache-2.0 / permissive | [upstream](https://github.com/eslint/rewrite/tree/main/packages/config-array#readme) | [LICENSE](public/vendor/licenses/npm/@eslint/config-array/LICENSE) |
| @eslint/config-helpers | 0.4.2 | Apache-2.0 / permissive | [upstream](https://github.com/eslint/rewrite/tree/main/packages/config-helpers#readme) | [LICENSE](public/vendor/licenses/npm/@eslint/config-helpers/LICENSE) |
| @eslint/core | 0.17.0 | Apache-2.0 / permissive | [upstream](https://github.com/eslint/rewrite/tree/main/packages/core#readme) | [LICENSE](public/vendor/licenses/npm/@eslint/core/LICENSE) |
| @eslint/eslintrc | 3.3.7 | MIT / permissive | [upstream](https://github.com/eslint/eslintrc#readme) | [LICENSE](public/vendor/licenses/npm/@eslint/eslintrc/LICENSE) |
| @eslint/js | 9.39.5 | MIT / permissive | [upstream](https://eslint.org) | [LICENSE](public/vendor/licenses/npm/@eslint/js/LICENSE) |
| @eslint/object-schema | 2.1.7 | Apache-2.0 / permissive | [upstream](https://github.com/eslint/rewrite/tree/main/packages/object-schema#readme) | [LICENSE](public/vendor/licenses/npm/@eslint/object-schema/LICENSE) |
| @eslint/plugin-kit | 0.4.1 | Apache-2.0 / permissive | [upstream](https://github.com/eslint/rewrite/tree/main/packages/plugin-kit#readme) | [LICENSE](public/vendor/licenses/npm/@eslint/plugin-kit/LICENSE) |
| @humanfs/core | 0.19.2 | Apache-2.0 / permissive | [upstream](https://github.com/humanwhocodes/humanfs#readme) | [LICENSE](public/vendor/licenses/npm/@humanfs/core/LICENSE) |
| @humanfs/node | 0.16.8 | Apache-2.0 / permissive | [upstream](https://github.com/humanwhocodes/humanfs#readme) | [LICENSE](public/vendor/licenses/npm/@humanfs/node/LICENSE) |
| @humanfs/types | 0.15.0 | Apache-2.0 / permissive | [upstream](https://github.com/humanwhocodes/humanfs#readme) | [README.md](public/vendor/licenses/npm/@humanfs/types/README.md) |
| @humanwhocodes/module-importer | 1.0.1 | Apache-2.0 / permissive | [upstream](https://www.npmjs.com/package/@humanwhocodes/module-importer/v/1.0.1) | [LICENSE](public/vendor/licenses/npm/@humanwhocodes/module-importer/LICENSE) |
| @humanwhocodes/retry | 0.4.3 | Apache-2.0 / permissive | [upstream](https://www.npmjs.com/package/@humanwhocodes/retry/v/0.4.3) | [LICENSE](public/vendor/licenses/npm/@humanwhocodes/retry/LICENSE) |
| @types/estree | 1.0.9 | MIT / permissive | [upstream](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/estree) | [LICENSE](public/vendor/licenses/npm/@types/estree/LICENSE) |
| @types/json-schema | 7.0.15 | MIT / permissive | [upstream](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/json-schema) | [LICENSE](public/vendor/licenses/npm/@types/json-schema/LICENSE) |
| @types/node | 24.19.2 | MIT / permissive | [upstream](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node) | [LICENSE](public/vendor/licenses/npm/@types/node/LICENSE) |
| @typescript-eslint/eslint-plugin | 8.71.2 | MIT / permissive | [upstream](https://typescript-eslint.io/packages/eslint-plugin) | [LICENSE](public/vendor/licenses/npm/@typescript-eslint/eslint-plugin/LICENSE) |
| ignore | 7.0.12 | MIT / permissive | [upstream](https://www.npmjs.com/package/ignore/v/7.0.12) | [LICENSE-MIT](public/vendor/licenses/npm/ignore/LICENSE-MIT) |
| @typescript-eslint/parser | 8.71.2 | MIT / permissive | [upstream](https://typescript-eslint.io/packages/parser) | [LICENSE](public/vendor/licenses/npm/@typescript-eslint/parser/LICENSE) |
| @typescript-eslint/project-service | 8.71.2 | MIT / permissive | [upstream](https://typescript-eslint.io) | [LICENSE](public/vendor/licenses/npm/@typescript-eslint/project-service/LICENSE) |
| @typescript-eslint/scope-manager | 8.71.2 | MIT / permissive | [upstream](https://typescript-eslint.io/packages/scope-manager) | [LICENSE](public/vendor/licenses/npm/@typescript-eslint/scope-manager/LICENSE) |
| @typescript-eslint/tsconfig-utils | 8.71.2 | MIT / permissive | [upstream](https://typescript-eslint.io) | [LICENSE](public/vendor/licenses/npm/@typescript-eslint/tsconfig-utils/LICENSE) |
| @typescript-eslint/type-utils | 8.71.2 | MIT / permissive | [upstream](https://typescript-eslint.io) | [LICENSE](public/vendor/licenses/npm/@typescript-eslint/type-utils/LICENSE) |
| @typescript-eslint/types | 8.71.2 | MIT / permissive | [upstream](https://typescript-eslint.io) | [LICENSE](public/vendor/licenses/npm/@typescript-eslint/types/LICENSE) |
| @typescript-eslint/typescript-estree | 8.71.2 | MIT / permissive | [upstream](https://typescript-eslint.io/packages/typescript-estree) | [LICENSE](public/vendor/licenses/npm/@typescript-eslint/typescript-estree/LICENSE) |
| balanced-match | 4.0.4 | MIT / permissive | [upstream](https://www.npmjs.com/package/balanced-match/v/4.0.4) | [LICENSE.md](public/vendor/licenses/npm/balanced-match/LICENSE.md) |
| brace-expansion | 5.0.12 | MIT / permissive | [upstream](https://www.npmjs.com/package/brace-expansion/v/5.0.12) | [LICENSE](public/vendor/licenses/npm/brace-expansion/LICENSE) |
| minimatch | 10.2.6 | BlueOak-1.0.0 / permissive | [upstream](https://www.npmjs.com/package/minimatch/v/10.2.6) | [LICENSE](public/vendor/licenses/npm/minimatch/LICENSE), [LICENSE.md](public/vendor/licenses/npm/minimatch/LICENSE.md) |
| @typescript-eslint/utils | 8.71.2 | MIT / permissive | [upstream](https://typescript-eslint.io/packages/utils) | [LICENSE](public/vendor/licenses/npm/@typescript-eslint/utils/LICENSE) |
| @typescript-eslint/visitor-keys | 8.71.2 | MIT / permissive | [upstream](https://typescript-eslint.io) | [LICENSE](public/vendor/licenses/npm/@typescript-eslint/visitor-keys/LICENSE) |
| eslint-visitor-keys | 5.0.1 | Apache-2.0 / permissive | [upstream](https://github.com/eslint/js/blob/main/packages/eslint-visitor-keys/README.md) | [LICENSE](public/vendor/licenses/npm/eslint-visitor-keys/LICENSE) |
| acorn | 8.19.0 | MIT / permissive | [upstream](https://github.com/acornjs/acorn) | [LICENSE](public/vendor/licenses/npm/acorn/LICENSE) |
| acorn-jsx | 5.3.2 | MIT / permissive | [upstream](https://github.com/acornjs/acorn-jsx) | [LICENSE](public/vendor/licenses/npm/acorn-jsx/LICENSE) |
| ajv | 6.15.0 | MIT / permissive | [upstream](https://github.com/ajv-validator/ajv) | [LICENSE](public/vendor/licenses/npm/ajv/LICENSE) |
| ansi-styles | 4.3.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/ansi-styles/v/4.3.0) | [license](public/vendor/licenses/npm/ansi-styles/license) |
| argparse | 2.0.1 | Python-2.0 / permissive | [upstream](https://www.npmjs.com/package/argparse/v/2.0.1) | [LICENSE](public/vendor/licenses/npm/argparse/LICENSE) |
| balanced-match | 1.0.2 | MIT / permissive | [upstream](https://github.com/juliangruber/balanced-match) | [LICENSE.md](public/vendor/licenses/npm/balanced-match/LICENSE.md) |
| brace-expansion | 1.1.21 | MIT / permissive | [upstream](https://github.com/juliangruber/brace-expansion) | [LICENSE](public/vendor/licenses/npm/brace-expansion/LICENSE) |
| callsites | 3.1.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/callsites/v/3.1.0) | [license](public/vendor/licenses/npm/callsites/license) |
| chalk | 4.1.2 | MIT / permissive | [upstream](https://www.npmjs.com/package/chalk/v/4.1.2) | [license](public/vendor/licenses/npm/chalk/license) |
| color-convert | 2.0.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/color-convert/v/2.0.1) | [LICENSE](public/vendor/licenses/npm/color-convert/LICENSE) |
| color-name | 1.1.4 | MIT / permissive | [upstream](https://github.com/colorjs/color-name) | [LICENSE](public/vendor/licenses/npm/color-name/LICENSE) |
| concat-map | 0.0.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/concat-map/v/0.0.1) | [LICENSE](public/vendor/licenses/npm/concat-map/LICENSE) |
| cross-spawn | 7.0.6 | MIT / permissive | [upstream](https://github.com/moxystudio/node-cross-spawn) | [LICENSE](public/vendor/licenses/npm/cross-spawn/LICENSE) |
| deep-is | 0.1.4 | MIT / permissive | [upstream](https://www.npmjs.com/package/deep-is/v/0.1.4) | [LICENSE](public/vendor/licenses/npm/deep-is/LICENSE) |
| esbuild | 0.28.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/esbuild/v/0.28.1) | [LICENSE.md](public/vendor/licenses/npm/esbuild/LICENSE.md) |
| escape-string-regexp | 4.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/escape-string-regexp/v/4.0.0) | [license](public/vendor/licenses/npm/escape-string-regexp/license) |
| eslint | 9.39.5 | MIT / permissive | [upstream](https://eslint.org) | [LICENSE](public/vendor/licenses/npm/eslint/LICENSE) |
| eslint-scope | 8.4.0 | BSD-2-Clause / permissive | [upstream](https://github.com/eslint/js/blob/main/packages/eslint-scope/README.md) | [LICENSE](public/vendor/licenses/npm/eslint-scope/LICENSE) |
| eslint-visitor-keys | 4.2.1 | Apache-2.0 / permissive | [upstream](https://github.com/eslint/js/blob/main/packages/eslint-visitor-keys/README.md) | [LICENSE](public/vendor/licenses/npm/eslint-visitor-keys/LICENSE) |
| espree | 10.4.0 | BSD-2-Clause / permissive | [upstream](https://github.com/eslint/js/blob/main/packages/espree/README.md) | [LICENSE](public/vendor/licenses/npm/espree/LICENSE) |
| esquery | 1.7.0 | BSD-3-Clause / permissive | [upstream](https://github.com/estools/esquery/) | [license.txt](public/vendor/licenses/npm/esquery/license.txt) |
| esrecurse | 4.3.0 | BSD-2-Clause / permissive | [upstream](https://github.com/estools/esrecurse) | [README.md](public/vendor/licenses/npm/esrecurse/README.md) |
| estraverse | 5.3.0 | BSD-2-Clause / permissive | [upstream](https://github.com/estools/estraverse) | [LICENSE.BSD](public/vendor/licenses/npm/estraverse/LICENSE.BSD) |
| esutils | 2.0.3 | BSD-2-Clause / permissive | [upstream](https://github.com/estools/esutils) | [LICENSE.BSD](public/vendor/licenses/npm/esutils/LICENSE.BSD) |
| fast-deep-equal | 3.1.3 | MIT / permissive | [upstream](https://github.com/epoberezkin/fast-deep-equal#readme) | [LICENSE](public/vendor/licenses/npm/fast-deep-equal/LICENSE) |
| fast-json-stable-stringify | 2.1.0 | MIT / permissive | [upstream](https://github.com/epoberezkin/fast-json-stable-stringify) | [LICENSE](public/vendor/licenses/npm/fast-json-stable-stringify/LICENSE) |
| fast-levenshtein | 2.0.6 | MIT / permissive | [upstream](https://www.npmjs.com/package/fast-levenshtein/v/2.0.6) | [LICENSE.md](public/vendor/licenses/npm/fast-levenshtein/LICENSE.md) |
| fdir | 6.5.0 | MIT / permissive | [upstream](https://github.com/thecodrr/fdir#readme) | [LICENSE](public/vendor/licenses/npm/fdir/LICENSE) |
| file-entry-cache | 8.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/file-entry-cache/v/8.0.0) | [LICENSE](public/vendor/licenses/npm/file-entry-cache/LICENSE) |
| find-up | 5.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/find-up/v/5.0.0) | [license](public/vendor/licenses/npm/find-up/license) |
| flat-cache | 4.0.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/flat-cache/v/4.0.1) | [LICENSE](public/vendor/licenses/npm/flat-cache/LICENSE) |
| flatted | 3.4.4 | ISC / permissive | [upstream](https://github.com/WebReflection/flatted#readme) | [LICENSE](public/vendor/licenses/npm/flatted/LICENSE) |
| glob-parent | 6.0.2 | ISC / permissive | [upstream](https://www.npmjs.com/package/glob-parent/v/6.0.2) | [LICENSE](public/vendor/licenses/npm/glob-parent/LICENSE) |
| globals | 14.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/globals/v/14.0.0) | [license](public/vendor/licenses/npm/globals/license) |
| has-flag | 4.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/has-flag/v/4.0.0) | [license](public/vendor/licenses/npm/has-flag/license) |
| ignore | 5.3.2 | MIT / permissive | [upstream](https://www.npmjs.com/package/ignore/v/5.3.2) | [LICENSE-MIT](public/vendor/licenses/npm/ignore/LICENSE-MIT) |
| import-fresh | 3.3.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/import-fresh/v/3.3.1) | [license](public/vendor/licenses/npm/import-fresh/license) |
| imurmurhash | 0.1.4 | MIT / permissive | [upstream](https://github.com/jensyt/imurmurhash-js) | [README.md](public/vendor/licenses/npm/imurmurhash/README.md) |
| is-extglob | 2.1.1 | MIT / permissive | [upstream](https://github.com/jonschlinkert/is-extglob) | [LICENSE](public/vendor/licenses/npm/is-extglob/LICENSE) |
| is-glob | 4.0.3 | MIT / permissive | [upstream](https://github.com/micromatch/is-glob) | [LICENSE](public/vendor/licenses/npm/is-glob/LICENSE) |
| isexe | 2.0.0 | ISC / permissive | [upstream](https://github.com/isaacs/isexe#readme) | [LICENSE](public/vendor/licenses/npm/isexe/LICENSE) |
| js-yaml | 4.3.2 | MIT / permissive | [upstream](https://www.npmjs.com/package/js-yaml/v/4.3.2) | [LICENSE](public/vendor/licenses/npm/js-yaml/LICENSE) |
| json-buffer | 3.0.1 | MIT / permissive | [upstream](https://github.com/dominictarr/json-buffer) | [LICENSE](public/vendor/licenses/npm/json-buffer/LICENSE) |
| json-schema-traverse | 0.4.1 | MIT / permissive | [upstream](https://github.com/epoberezkin/json-schema-traverse#readme) | [LICENSE](public/vendor/licenses/npm/json-schema-traverse/LICENSE) |
| json-stable-stringify-without-jsonify | 1.0.1 | MIT / permissive | [upstream](https://github.com/samn/json-stable-stringify) | [LICENSE](public/vendor/licenses/npm/json-stable-stringify-without-jsonify/LICENSE) |
| keyv | 4.5.4 | MIT / permissive | [upstream](https://github.com/jaredwray/keyv) | [README.md](public/vendor/licenses/npm/keyv/README.md), [LICENSE.from-package-readme.txt](public/vendor/licenses/npm/keyv/LICENSE.from-package-readme.txt) |
| levn | 0.4.1 | MIT / permissive | [upstream](https://github.com/gkz/levn) | [LICENSE](public/vendor/licenses/npm/levn/LICENSE) |
| locate-path | 6.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/locate-path/v/6.0.0) | [license](public/vendor/licenses/npm/locate-path/license) |
| lodash.merge | 4.6.2 | MIT / permissive | [upstream](https://lodash.com/) | [LICENSE](public/vendor/licenses/npm/lodash.merge/LICENSE) |
| minimatch | 3.1.5 | ISC / permissive | [upstream](https://www.npmjs.com/package/minimatch/v/3.1.5) | [LICENSE](public/vendor/licenses/npm/minimatch/LICENSE), [LICENSE.md](public/vendor/licenses/npm/minimatch/LICENSE.md) |
| natural-compare | 1.4.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/natural-compare/v/1.4.0) | [README.md](public/vendor/licenses/npm/natural-compare/README.md) |
| optionator | 0.9.4 | MIT / permissive | [upstream](https://github.com/gkz/optionator) | [LICENSE](public/vendor/licenses/npm/optionator/LICENSE) |
| p-limit | 3.1.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/p-limit/v/3.1.0) | [license](public/vendor/licenses/npm/p-limit/license) |
| p-locate | 5.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/p-locate/v/5.0.0) | [license](public/vendor/licenses/npm/p-locate/license) |
| parent-module | 1.0.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/parent-module/v/1.0.1) | [license](public/vendor/licenses/npm/parent-module/license) |
| path-exists | 4.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/path-exists/v/4.0.0) | [license](public/vendor/licenses/npm/path-exists/license) |
| path-key | 3.1.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/path-key/v/3.1.1) | [license](public/vendor/licenses/npm/path-key/license) |
| picomatch | 4.0.7 | MIT / permissive | [upstream](https://github.com/micromatch/picomatch) | [LICENSE](public/vendor/licenses/npm/picomatch/LICENSE) |
| playwright | 1.64.1 | Apache-2.0 / permissive | [upstream](https://playwright.dev) | [LICENSE](public/vendor/licenses/npm/playwright/LICENSE), [NOTICE](public/vendor/licenses/npm/playwright/NOTICE) |
| playwright-core | 1.64.1 | Apache-2.0 / permissive | [upstream](https://playwright.dev) | [LICENSE](public/vendor/licenses/npm/playwright-core/LICENSE), [NOTICE](public/vendor/licenses/npm/playwright-core/NOTICE) |
| prelude-ls | 1.2.1 | MIT / permissive | [upstream](http://preludels.com) | [LICENSE](public/vendor/licenses/npm/prelude-ls/LICENSE) |
| punycode | 2.3.1 | MIT / permissive | [upstream](https://mths.be/punycode) | [LICENSE-MIT.txt](public/vendor/licenses/npm/punycode/LICENSE-MIT.txt) |
| resolve-from | 4.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/resolve-from/v/4.0.0) | [license](public/vendor/licenses/npm/resolve-from/license) |
| semver | 7.8.5 | ISC / permissive | [upstream](https://www.npmjs.com/package/semver/v/7.8.5) | [LICENSE](public/vendor/licenses/npm/semver/LICENSE) |
| shebang-command | 2.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/shebang-command/v/2.0.0) | [license](public/vendor/licenses/npm/shebang-command/license) |
| shebang-regex | 3.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/shebang-regex/v/3.0.0) | [license](public/vendor/licenses/npm/shebang-regex/license) |
| strip-json-comments | 3.1.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/strip-json-comments/v/3.1.1) | [license](public/vendor/licenses/npm/strip-json-comments/license) |
| supports-color | 7.2.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/supports-color/v/7.2.0) | [license](public/vendor/licenses/npm/supports-color/license) |
| tinyglobby | 0.2.17 | MIT / permissive | [upstream](https://superchupu.dev/tinyglobby) | [LICENSE](public/vendor/licenses/npm/tinyglobby/LICENSE) |
| ts-api-utils | 2.5.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/ts-api-utils/v/2.5.0) | [LICENSE.md](public/vendor/licenses/npm/ts-api-utils/LICENSE.md) |
| type-check | 0.4.0 | MIT / permissive | [upstream](https://github.com/gkz/type-check) | [LICENSE](public/vendor/licenses/npm/type-check/LICENSE) |
| typescript | 5.9.3 | Apache-2.0 / permissive | [upstream](https://www.typescriptlang.org/) | [LICENSE.txt](public/vendor/licenses/npm/typescript/LICENSE.txt) |
| typescript-eslint | 8.71.2 | MIT / permissive | [upstream](https://typescript-eslint.io/packages/typescript-eslint) | [LICENSE](public/vendor/licenses/npm/typescript-eslint/LICENSE) |
| undici-types | 7.24.6 | MIT / permissive | [upstream](https://undici.nodejs.org) | [LICENSE](public/vendor/licenses/npm/undici-types/LICENSE) |
| uri-js | 4.4.1 | BSD-2-Clause / permissive | [upstream](https://github.com/garycourt/uri-js) | [LICENSE](public/vendor/licenses/npm/uri-js/LICENSE) |
| which | 2.0.2 | ISC / permissive | [upstream](https://www.npmjs.com/package/which/v/2.0.2) | [LICENSE](public/vendor/licenses/npm/which/LICENSE) |
| word-wrap | 1.2.5 | MIT / permissive | [upstream](https://github.com/jonschlinkert/word-wrap) | [LICENSE](public/vendor/licenses/npm/word-wrap/LICENSE) |
| yocto-queue | 0.1.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/yocto-queue/v/0.1.0) | [license](public/vendor/licenses/npm/yocto-queue/license) |
| @adobe/css-tools | 4.5.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/@adobe/css-tools/v/4.5.0) | [LICENSE](public/vendor/licenses/npm/@adobe/css-tools/LICENSE) |
| @asamuzakjp/css-color | 7.1.9 | MIT / permissive | [upstream](https://github.com/asamuzaK/cssColor#readme) | [LICENSE](public/vendor/licenses/npm/@asamuzakjp/css-color/LICENSE) |
| @asamuzakjp/dom-selector | 10.0.5 | MIT / permissive | [upstream](https://github.com/asamuzaK/domSelector#readme) | [LICENSE](public/vendor/licenses/npm/@asamuzakjp/dom-selector/LICENSE) |
| @babel/code-frame | 7.29.7 | MIT / permissive | [upstream](https://babel.dev/docs/en/next/babel-code-frame) | [LICENSE](public/vendor/licenses/npm/@babel/code-frame/LICENSE) |
| @babel/helper-validator-identifier | 7.29.7 | MIT / permissive | [upstream](https://www.npmjs.com/package/@babel/helper-validator-identifier/v/7.29.7) | [LICENSE](public/vendor/licenses/npm/@babel/helper-validator-identifier/LICENSE) |
| @babel/runtime | 7.29.10 | MIT / permissive | [upstream](https://babel.dev/docs/en/next/babel-runtime) | [LICENSE](public/vendor/licenses/npm/@babel/runtime/LICENSE) |
| @bramus/specificity | 2.4.3 | MIT / permissive | [upstream](https://github.com/bramus/specificity#readme) | [LICENSE](public/vendor/licenses/npm/@bramus/specificity/LICENSE) |
| @csstools/color-helpers | 6.1.2 | MIT-0 / permissive | [upstream](https://github.com/csstools/postcss-plugins/tree/main/packages/color-helpers#readme) | [LICENSE.md](public/vendor/licenses/npm/@csstools/color-helpers/LICENSE.md) |
| @csstools/css-calc | 3.4.3 | MIT / permissive | [upstream](https://github.com/csstools/postcss-plugins/tree/main/packages/css-calc#readme) | [LICENSE.md](public/vendor/licenses/npm/@csstools/css-calc/LICENSE.md) |
| @csstools/css-color-parser | 4.2.7 | MIT / permissive | [upstream](https://github.com/csstools/postcss-plugins/tree/main/packages/css-color-parser#readme) | [LICENSE.md](public/vendor/licenses/npm/@csstools/css-color-parser/LICENSE.md) |
| @csstools/css-parser-algorithms | 4.0.2 | MIT / permissive | [upstream](https://github.com/csstools/postcss-plugins/tree/main/packages/css-parser-algorithms#readme) | [LICENSE.md](public/vendor/licenses/npm/@csstools/css-parser-algorithms/LICENSE.md) |
| @csstools/css-syntax-patches-for-csstree | 1.1.16 | MIT-0 / permissive | [upstream](https://github.com/csstools/postcss-plugins/tree/main/packages/css-syntax-patches-for-csstree#readme) | [LICENSE.md](public/vendor/licenses/npm/@csstools/css-syntax-patches-for-csstree/LICENSE.md) |
| @csstools/css-tokenizer | 4.0.2 | MIT / permissive | [upstream](https://github.com/csstools/postcss-plugins/tree/main/packages/css-tokenizer#readme) | [LICENSE.md](public/vendor/licenses/npm/@csstools/css-tokenizer/LICENSE.md) |
| @exodus/bytes | 1.16.0 | MIT / permissive | [upstream](https://github.com/ExodusOSS/bytes) | [LICENSE](public/vendor/licenses/npm/@exodus/bytes/LICENSE) |
| @jridgewell/resolve-uri | 3.1.2 | MIT / permissive | [upstream](https://www.npmjs.com/package/@jridgewell/resolve-uri/v/3.1.2) | [LICENSE](public/vendor/licenses/npm/@jridgewell/resolve-uri/LICENSE) |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT / permissive | [upstream](https://github.com/jridgewell/sourcemaps/tree/main/packages/sourcemap-codec) | [LICENSE](public/vendor/licenses/npm/@jridgewell/sourcemap-codec/LICENSE) |
| @jridgewell/trace-mapping | 0.3.31 | MIT / permissive | [upstream](https://github.com/jridgewell/sourcemaps/tree/main/packages/trace-mapping) | [LICENSE](public/vendor/licenses/npm/@jridgewell/trace-mapping/LICENSE) |
| @oxc-project/types | 0.156.0 | MIT / permissive | [upstream](https://oxc.rs) | [LICENSE](public/vendor/licenses/npm/@oxc-project/types/LICENSE) |
| @rolldown/binding-android-arm-eabi | 1.2.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/@rolldown/binding-android-arm-eabi/v/1.2.16) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/binding-android-arm64 | 1.2.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/@rolldown/binding-android-arm64/v/1.2.16) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/binding-darwin-arm64 | 1.2.16 | MIT / permissive | [upstream](https://rolldown.rs/) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/binding-darwin-x64 | 1.2.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/@rolldown/binding-darwin-x64/v/1.2.16) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/binding-freebsd-x64 | 1.2.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/@rolldown/binding-freebsd-x64/v/1.2.16) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/binding-linux-arm-gnueabihf | 1.2.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/@rolldown/binding-linux-arm-gnueabihf/v/1.2.16) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/binding-linux-arm64-gnu | 1.2.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/@rolldown/binding-linux-arm64-gnu/v/1.2.16) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/binding-linux-arm64-musl | 1.2.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/@rolldown/binding-linux-arm64-musl/v/1.2.16) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/binding-linux-ppc64-gnu | 1.2.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/@rolldown/binding-linux-ppc64-gnu/v/1.2.16) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/binding-linux-s390x-gnu | 1.2.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/@rolldown/binding-linux-s390x-gnu/v/1.2.16) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/binding-linux-x64-gnu | 1.2.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/@rolldown/binding-linux-x64-gnu/v/1.2.16) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/binding-linux-x64-musl | 1.2.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/@rolldown/binding-linux-x64-musl/v/1.2.16) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/binding-openharmony-arm64 | 1.2.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/@rolldown/binding-openharmony-arm64/v/1.2.16) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/binding-win32-arm64-msvc | 1.2.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/@rolldown/binding-win32-arm64-msvc/v/1.2.16) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/binding-win32-x64-msvc | 1.2.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/@rolldown/binding-win32-x64-msvc/v/1.2.16) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) (platform binary of rolldown; MIT per exact-version registry metadata) |
| @rolldown/pluginutils | 1.0.1 | MIT / permissive | [upstream](https://github.com/rolldown/plugins/tree/main/packages/pluginutils#readme) | [LICENSE](public/vendor/licenses/npm/@rolldown/pluginutils/LICENSE) |
| @testing-library/dom | 10.4.2 | MIT / permissive | [upstream](https://github.com/testing-library/dom-testing-library#readme) | [LICENSE](public/vendor/licenses/npm/@testing-library/dom/LICENSE) |
| @testing-library/jest-dom | 7.0.1 | MIT / permissive | [upstream](https://github.com/testing-library/jest-dom#readme) | [LICENSE](public/vendor/licenses/npm/@testing-library/jest-dom/LICENSE) |
| dom-accessibility-api | 0.6.3 | MIT / permissive | [upstream](https://www.npmjs.com/package/dom-accessibility-api/v/0.6.3) | [LICENSE.md](public/vendor/licenses/npm/dom-accessibility-api/LICENSE.md) |
| @testing-library/react | 16.3.3 | MIT / permissive | [upstream](https://github.com/testing-library/react-testing-library#readme) | [LICENSE](public/vendor/licenses/npm/@testing-library/react/LICENSE) |
| @testing-library/user-event | 14.6.8 | MIT / permissive | [upstream](https://github.com/testing-library/user-event#readme) | [LICENSE](public/vendor/licenses/npm/@testing-library/user-event/LICENSE) |
| @types/aria-query | 5.0.4 | MIT / permissive | [upstream](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/aria-query) | [LICENSE](public/vendor/licenses/npm/@types/aria-query/LICENSE) |
| @types/chai | 5.2.3 | MIT / permissive | [upstream](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/chai) | [LICENSE](public/vendor/licenses/npm/@types/chai/LICENSE) |
| @types/deep-eql | 4.0.2 | MIT / permissive | [upstream](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/deep-eql) | [LICENSE](public/vendor/licenses/npm/@types/deep-eql/LICENSE) |
| @types/react | 19.3.0 | MIT / permissive | [upstream](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react) | [LICENSE](public/vendor/licenses/npm/@types/react/LICENSE) |
| @types/react-dom | 19.3.0 | MIT / permissive | [upstream](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react-dom) | [LICENSE](public/vendor/licenses/npm/@types/react-dom/LICENSE) |
| @vitest/mocker | 5.1.0 | MIT / permissive | [upstream](https://github.com/vitest-dev/vitest/tree/main/packages/mocker) | [LICENSE](public/vendor/licenses/npm/@vitest/mocker/LICENSE) |
| @vitest/spy | 5.1.0 | MIT / permissive | [upstream](https://vitest.dev/api/mock) | [LICENSE](public/vendor/licenses/npm/@vitest/spy/LICENSE) |
| ansi-regex | 5.0.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/ansi-regex/v/5.0.1) | [license](public/vendor/licenses/npm/ansi-regex/license) |
| aria-query | 5.3.0 | Apache-2.0 / permissive | [upstream](https://github.com/A11yance/aria-query#readme) | [LICENSE](public/vendor/licenses/npm/aria-query/LICENSE) |
| assertion-error | 2.0.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/assertion-error/v/2.0.1) | [LICENSE](public/vendor/licenses/npm/assertion-error/LICENSE) |
| bidi-js | 1.1.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/bidi-js/v/1.1.0) | [LICENSE.txt](public/vendor/licenses/npm/bidi-js/LICENSE.txt) |
| chai | 6.3.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/chai/v/6.3.0) | [LICENSE](public/vendor/licenses/npm/chai/LICENSE) |
| css-tree | 3.2.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/css-tree/v/3.2.1) | [LICENSE](public/vendor/licenses/npm/css-tree/LICENSE) |
| css.escape | 1.5.1 | MIT / permissive | [upstream](https://mths.be/cssescape) | [LICENSE-MIT.txt](public/vendor/licenses/npm/css.escape/LICENSE-MIT.txt) |
| csstype | 3.2.3 | MIT / permissive | [upstream](https://www.npmjs.com/package/csstype/v/3.2.3) | [LICENSE](public/vendor/licenses/npm/csstype/LICENSE) |
| data-urls | 8.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/data-urls/v/8.0.0) | [LICENSE.txt](public/vendor/licenses/npm/data-urls/LICENSE.txt) |
| decimal.js | 10.6.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/decimal.js/v/10.6.0) | [LICENCE.md](public/vendor/licenses/npm/decimal.js/LICENCE.md) |
| dequal | 2.0.3 | MIT / permissive | [upstream](https://www.npmjs.com/package/dequal/v/2.0.3) | [license](public/vendor/licenses/npm/dequal/license) |
| detect-libc | 2.1.2 | Apache-2.0 / permissive | [upstream](https://www.npmjs.com/package/detect-libc/v/2.1.2) | [LICENSE](public/vendor/licenses/npm/detect-libc/LICENSE) |
| dom-accessibility-api | 0.5.16 | MIT / permissive | [upstream](https://www.npmjs.com/package/dom-accessibility-api/v/0.5.16) | [LICENSE.md](public/vendor/licenses/npm/dom-accessibility-api/LICENSE.md) |
| entities | 9.0.0 | BSD-2-Clause / permissive | [upstream](https://www.npmjs.com/package/entities/v/9.0.0) | [LICENSE](public/vendor/licenses/npm/entities/LICENSE) |
| es-module-lexer | 2.3.2 | MIT / permissive | [upstream](https://github.com/guybedford/es-module-lexer#readme) | [LICENSE](public/vendor/licenses/npm/es-module-lexer/LICENSE) |
| estree-walker | 3.0.3 | MIT / permissive | [upstream](https://www.npmjs.com/package/estree-walker/v/3.0.3) | [LICENSE](public/vendor/licenses/npm/estree-walker/LICENSE) |
| expect-type | 1.4.0 | Apache-2.0 / permissive | [upstream](https://github.com/mmkal/expect-type#readme) | [LICENSE](public/vendor/licenses/npm/expect-type/LICENSE) |
| fsevents | 2.3.3 | MIT / permissive | [upstream](https://www.npmjs.com/package/fsevents/v/2.3.3) | Optional and not installed by this lockfile's npm ci; MIT per exact-version registry metadata |
| html-encoding-sniffer | 7.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/html-encoding-sniffer/v/7.0.0) | [LICENSE.txt](public/vendor/licenses/npm/html-encoding-sniffer/LICENSE.txt) |
| indent-string | 4.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/indent-string/v/4.0.0) | [license](public/vendor/licenses/npm/indent-string/license) |
| is-potential-custom-element-name | 1.0.1 | MIT / permissive | [upstream](https://github.com/mathiasbynens/is-potential-custom-element-name) | [LICENSE-MIT.txt](public/vendor/licenses/npm/is-potential-custom-element-name/LICENSE-MIT.txt) |
| js-tokens | 4.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/js-tokens/v/4.0.0) | [LICENSE](public/vendor/licenses/npm/js-tokens/LICENSE) |
| jsdom | 30.1.3 | MIT / permissive | [upstream](https://www.npmjs.com/package/jsdom/v/30.1.3) | [LICENSE.txt](public/vendor/licenses/npm/jsdom/LICENSE.txt) |
| lightningcss | 1.33.0 | MPL-2.0 / weak copyleft | [upstream](https://www.npmjs.com/package/lightningcss/v/1.33.0) | [LICENSE](public/vendor/licenses/npm/lightningcss/LICENSE) |
| lightningcss-android-arm64 | 1.33.0 | MPL-2.0 / weak copyleft | [upstream](https://www.npmjs.com/package/lightningcss-android-arm64/v/1.33.0) | [LICENSE](public/vendor/licenses/npm/lightningcss/LICENSE) (platform binary of lightningcss; MPL-2.0 per exact-version registry metadata) |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 / weak copyleft | [upstream](https://www.npmjs.com/package/lightningcss-darwin-arm64/v/1.33.0) | [LICENSE](public/vendor/licenses/npm/lightningcss-darwin-arm64/LICENSE) |
| lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 / weak copyleft | [upstream](https://www.npmjs.com/package/lightningcss-darwin-x64/v/1.33.0) | [LICENSE](public/vendor/licenses/npm/lightningcss/LICENSE) (platform binary of lightningcss; MPL-2.0 per exact-version registry metadata) |
| lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 / weak copyleft | [upstream](https://www.npmjs.com/package/lightningcss-freebsd-x64/v/1.33.0) | [LICENSE](public/vendor/licenses/npm/lightningcss/LICENSE) (platform binary of lightningcss; MPL-2.0 per exact-version registry metadata) |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 / weak copyleft | [upstream](https://www.npmjs.com/package/lightningcss-linux-arm-gnueabihf/v/1.33.0) | [LICENSE](public/vendor/licenses/npm/lightningcss/LICENSE) (platform binary of lightningcss; MPL-2.0 per exact-version registry metadata) |
| lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 / weak copyleft | [upstream](https://www.npmjs.com/package/lightningcss-linux-arm64-gnu/v/1.33.0) | [LICENSE](public/vendor/licenses/npm/lightningcss/LICENSE) (platform binary of lightningcss; MPL-2.0 per exact-version registry metadata) |
| lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 / weak copyleft | [upstream](https://www.npmjs.com/package/lightningcss-linux-arm64-musl/v/1.33.0) | [LICENSE](public/vendor/licenses/npm/lightningcss/LICENSE) (platform binary of lightningcss; MPL-2.0 per exact-version registry metadata) |
| lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 / weak copyleft | [upstream](https://www.npmjs.com/package/lightningcss-linux-x64-gnu/v/1.33.0) | [LICENSE](public/vendor/licenses/npm/lightningcss/LICENSE) (platform binary of lightningcss; MPL-2.0 per exact-version registry metadata) |
| lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 / weak copyleft | [upstream](https://www.npmjs.com/package/lightningcss-linux-x64-musl/v/1.33.0) | [LICENSE](public/vendor/licenses/npm/lightningcss/LICENSE) (platform binary of lightningcss; MPL-2.0 per exact-version registry metadata) |
| lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 / weak copyleft | [upstream](https://www.npmjs.com/package/lightningcss-win32-arm64-msvc/v/1.33.0) | [LICENSE](public/vendor/licenses/npm/lightningcss/LICENSE) (platform binary of lightningcss; MPL-2.0 per exact-version registry metadata) |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 / weak copyleft | [upstream](https://www.npmjs.com/package/lightningcss-win32-x64-msvc/v/1.33.0) | [LICENSE](public/vendor/licenses/npm/lightningcss/LICENSE) (platform binary of lightningcss; MPL-2.0 per exact-version registry metadata) |
| lru-cache | 11.5.3 | BlueOak-1.0.0 / permissive | [upstream](https://www.npmjs.com/package/lru-cache/v/11.5.3) | [LICENSE.md](public/vendor/licenses/npm/lru-cache/LICENSE.md) |
| lz-string | 1.5.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/lz-string/v/1.5.0) | [LICENSE](public/vendor/licenses/npm/lz-string/LICENSE) |
| magic-string | 1.4.5 | MIT / permissive | [upstream](https://www.npmjs.com/package/magic-string/v/1.4.5) | [LICENSE](public/vendor/licenses/npm/magic-string/LICENSE) |
| mdn-data | 2.27.1 | CC0-1.0 / permissive | [upstream](https://developer.mozilla.org) | [LICENSE](public/vendor/licenses/npm/mdn-data/LICENSE) |
| min-indent | 1.0.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/min-indent/v/1.0.1) | [license](public/vendor/licenses/npm/min-indent/license) |
| nanoid | 3.3.20 | MIT / permissive | [upstream](https://www.npmjs.com/package/nanoid/v/3.3.20) | [LICENSE](public/vendor/licenses/npm/nanoid/LICENSE) |
| obug | 3.0.0 | MIT / permissive | [upstream](https://github.com/sxzz/obug#readme) | [LICENSE](public/vendor/licenses/npm/obug/LICENSE) |
| parse5 | 8.1.0 | MIT / permissive | [upstream](https://parse5.js.org) | [LICENSE](public/vendor/licenses/npm/parse5/LICENSE) |
| picocolors | 1.1.1 | ISC / permissive | [upstream](https://www.npmjs.com/package/picocolors/v/1.1.1) | [LICENSE](public/vendor/licenses/npm/picocolors/LICENSE) |
| postcss | 8.5.32 | MIT / permissive | [upstream](https://postcss.org/) | [LICENSE](public/vendor/licenses/npm/postcss/LICENSE) |
| pretty-format | 27.5.1 | MIT / permissive | [upstream](https://www.npmjs.com/package/pretty-format/v/27.5.1) | [LICENSE](public/vendor/licenses/npm/pretty-format/LICENSE) |
| ansi-styles | 5.2.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/ansi-styles/v/5.2.0) | [license](public/vendor/licenses/npm/ansi-styles/license) |
| react-is | 17.0.2 | MIT / permissive | [upstream](https://reactjs.org/) | [LICENSE](public/vendor/licenses/npm/react-is/LICENSE) |
| redent | 3.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/redent/v/3.0.0) | [license](public/vendor/licenses/npm/redent/license) |
| require-from-string | 2.0.2 | MIT / permissive | [upstream](https://www.npmjs.com/package/require-from-string/v/2.0.2) | [license](public/vendor/licenses/npm/require-from-string/license) |
| rolldown | 1.2.16 | MIT / permissive | [upstream](https://rolldown.rs/) | [LICENSE](public/vendor/licenses/npm/rolldown/LICENSE) |
| saxes | 6.0.0 | ISC / permissive | [upstream](https://www.npmjs.com/package/saxes/v/6.0.0) | ISC per exact-version registry metadata; package ships no separate license file |
| source-map-js | 1.2.2 | BSD-3-Clause / permissive | [upstream](https://github.com/7rulnik/source-map-js) | [LICENSE](public/vendor/licenses/npm/source-map-js/LICENSE) |
| std-env | 4.3.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/std-env/v/4.3.0) | [LICENCE](public/vendor/licenses/npm/std-env/LICENCE) |
| strip-indent | 3.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/strip-indent/v/3.0.0) | [license](public/vendor/licenses/npm/strip-indent/license) |
| tinybench | 6.2.3 | MIT / permissive | [upstream](https://github.com/tinylibs/tinybench#readme) | [LICENSE](public/vendor/licenses/npm/tinybench/LICENSE) |
| tinyexec | 1.3.1 | MIT / permissive | [upstream](https://github.com/tinylibs/tinyexec#readme) | [LICENSE](public/vendor/licenses/npm/tinyexec/LICENSE) |
| tldts | 7.4.19 | MIT / permissive | [upstream](https://github.com/remusao/tldts#readme) | [LICENSE](public/vendor/licenses/npm/tldts/LICENSE) |
| tldts-core | 7.4.20 | MIT / permissive | [upstream](https://github.com/remusao/tldts#readme) | [LICENSE](public/vendor/licenses/npm/tldts-core/LICENSE) |
| tough-cookie | 6.0.2 | BSD-3-Clause / permissive | [upstream](https://github.com/salesforce/tough-cookie) | [LICENSE](public/vendor/licenses/npm/tough-cookie/LICENSE) |
| tr46 | 7.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/tr46/v/7.0.0) | [LICENSE.md](public/vendor/licenses/npm/tr46/LICENSE.md) |
| undici | 8.12.3 | MIT / permissive | [upstream](https://undici.nodejs.org) | [LICENSE](public/vendor/licenses/npm/undici/LICENSE) |
| vite | 8.3.5 | MIT / permissive | [upstream](https://vite.dev) | [LICENSE.md](public/vendor/licenses/npm/vite/LICENSE.md) |
| vitest | 5.1.0 | MIT / permissive | [upstream](https://vitest.dev) | [LICENSE.md](public/vendor/licenses/npm/vitest/LICENSE.md) |
| w3c-xmlserializer | 6.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/w3c-xmlserializer/v/6.0.0) | [LICENSE.md](public/vendor/licenses/npm/w3c-xmlserializer/LICENSE.md) |
| webidl-conversions | 8.0.1 | BSD-2-Clause / permissive | [upstream](https://www.npmjs.com/package/webidl-conversions/v/8.0.1) | [LICENSE.md](public/vendor/licenses/npm/webidl-conversions/LICENSE.md) |
| whatwg-mimetype | 5.0.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/whatwg-mimetype/v/5.0.0) | [LICENSE.txt](public/vendor/licenses/npm/whatwg-mimetype/LICENSE.txt) |
| whatwg-url | 17.3.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/whatwg-url/v/17.3.0) | [LICENSE.txt](public/vendor/licenses/npm/whatwg-url/LICENSE.txt) |
| why-is-node-running | 3.2.1 | MIT / permissive | [upstream](https://github.com/mafintosh/why-is-node-running) | [LICENSE](public/vendor/licenses/npm/why-is-node-running/LICENSE) |
| xml-name-validator | 5.0.0 | Apache-2.0 / permissive | [upstream](https://www.npmjs.com/package/xml-name-validator/v/5.0.0) | [LICENSE.txt](public/vendor/licenses/npm/xml-name-validator/LICENSE.txt) |
| xmlchars | 2.2.0 | MIT / permissive | [upstream](https://www.npmjs.com/package/xmlchars/v/2.2.0) | [LICENSE](public/vendor/licenses/npm/xmlchars/LICENSE) |

## Vendored browser code and fonts

Exact upstream tarball URLs, hashes and byte-comparison results: [SOURCE_VERIFICATION.json](public/vendor/SOURCE_VERIFICATION.json).


| Component | Version | License | Source and notice |
|---|---|---|---|
| Barlow and Barlow Semi Condensed | Regular 400, Medium 500, SemiBold 600; Semi Condensed Medium 500 and SemiBold 600 | SIL OFL-1.1 | [Barlow source](https://github.com/google/fonts/tree/main/ofl/barlow), [Semi Condensed source](https://github.com/google/fonts/tree/main/ofl/barlowsemicondensed). Self-hosted WOFF2 conversions without glyph changes. Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow). Complete terms: [Barlow OFL](public/vendor/licenses/barlow/OFL.txt), [Semi Condensed OFL](public/vendor/licenses/barlow-semi-condensed/OFL.txt). |
| PDF.js browser module and worker | 5.6.205 | Apache-2.0 | https://github.com/mozilla/pdf.js ; [LICENSE](public/vendor/pdfjs/LICENSE). Both files are byte-identical to pdfjs-dist 5.6.205 build/pdf.mjs and build/pdf.worker.mjs. No runtime-specific modifications. Upstream package has no root NOTICE file; upstream headers and license are retained. CMap/ICC license texts are retained conservatively; their binary assets are not bundled here. |
| KaTeX, auto-render, CSS and 60 fonts | 0.18.7 | MIT | https://github.com/KaTeX/KaTeX ; [LICENSE](public/vendor/katex/LICENSE). All 63 files byte-identical to upstream package. All bundled font files are KaTeX fonts; no Apple/system font files. |
| marked | 18.0.13 | MIT | https://github.com/markedjs/marked ; [LICENSE](public/vendor/marked/LICENSE). Byte-identical upstream ESM. |
| perfect-freehand | 1.2.3 | MIT | https://github.com/steveruizok/perfect-freehand ; [notice](public/vendor/perfect-freehand-NOTICE.txt). Upstream ESM with source-map comment omitted; provenance and content hash in perfect-freehand-source.json. |
| Tiptap / ProseMirror document-runtime bundle | Versions in runtime table | MIT | Generated from src/frontend/document-runtime.mjs and lockfile. Full attributions: [document-runtime.NOTICE.txt](public/vendor/document-runtime.NOTICE.txt). Individual modules are already counted in the runtime table. |
| React finances view bundle | React 19.3.1, React DOM 19.3.1, scheduler 0.28.0 | MIT | Generated from src/frontend/react/ by tools/build.mjs into public/react/. Upstream `@license` headers are kept at the end of each output file; the packages are counted in the runtime table above. |

## Obligations and notices

lightningcss and its platform binaries (MPL-2.0) arrive only as development dependencies of Vitest/Vite. They are used unmodified for tests and are not part of any LifeOS build output.

web-push 3.6.7 is MPL-2.0 and is used unmodified as a dependency. Preserve its MPL license and covered-source availability when redistributing it; modifications to its covered files remain MPL, while original application code can remain MIT. Its source is https://github.com/web-push-libs/web-push . No AGPL/GPL runtime dependency was found. BlueOak-1.0.0 and Python-2.0 are permissive grants.

Exact installed dependency license/NOTICE files are reproduced under [public/vendor/licenses/npm](public/vendor/licenses/npm/). Keep them when redistributing a build. Apache-2.0 NOTICE files (including google-auth-library and TypeScript, when supplied by upstream) remain verbatim there; the original source notices in vendored JS remain intact. esbuild platform binaries use the parent esbuild MIT license. Some upstream packages place terms in README/source headers rather than a standalone license file; those original texts are retained alongside their metadata.

### Preserved Apache NOTICE text

Required third-party NOTICE files from installed Apache components are reproduced verbatim below; retain their separate upstream license files too.

#### playwright/NOTICE

```text
Playwright
Copyright (c) Microsoft Corporation

This software contains code derived from the Puppeteer project (https://github.com/puppeteer/puppeteer),
available under the Apache 2.0 license (https://github.com/puppeteer/puppeteer/blob/master/LICENSE).
```

#### playwright-core/NOTICE

```text
Playwright
Copyright (c) Microsoft Corporation

This software contains code derived from the Puppeteer project (https://github.com/puppeteer/puppeteer),
available under the Apache 2.0 license (https://github.com/puppeteer/puppeteer/blob/master/LICENSE).
```

## Assets and copied code

See [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md) for every demo asset, icon, screenshot and font. Demo media and icons were regenerated from original geometric art, teaching text and synthesized narration. The optional narration generator uses espeak-ng 1.0.2 (GPL-3.0-or-later; https://www.npmjs.com/package/espeak-ng/v/1.0.2) as an external build tool. The compiler/synthesizer is not bundled or a runtime dependency; the output is original speech from supplied text, with no sampled voice recordings or embedded software. Preserve the GPL if redistributing the generator itself. Pillow, used only to generate art, is MIT-CMU.

No uncredited Stack Overflow/blog/repository copies were found outside the explicit vendored components. UI symbols are authored CSS/inline vector shapes or Unicode characters rendered by the user’s system fonts; no third-party icon font is bundled outside KaTeX.

The added row-action SVG shapes in `public/ui.js` are original geometric drawings under MIT. No third-party icon package was added.

## Optional local Whisper dependencies

The opt-in Python environment is installed from
`tools/whisper/requirements.lock`; model weights and Python packages are not
bundled in this repository. Upstream code and model terms apply:
[faster-whisper](https://github.com/SYSTRAN/faster-whisper),
[CTranslate2](https://github.com/OpenNMT/CTranslate2),
[PyAV](https://github.com/PyAV-Org/PyAV), and
[OpenAI Whisper models](https://github.com/openai/whisper).
The public-domain historical audio fixture is documented separately in
`test/fixtures/whisper/README.md` and `ASSET_PROVENANCE.md`.

## Workload chart dependencies

The locally bundled chart modules and their dependencies retain these terms.

| Component | Version | License | Source | Preserved terms |
|---|---|---|---|---|
| d3-array | 3.2.5 | ISC | [upstream](https://www.npmjs.com/package/d3-array/v/3.2.5) | [LICENSE](public/vendor/licenses/npm/d3-array/LICENSE) |
| d3-axis | 3.0.0 | ISC | [upstream](https://www.npmjs.com/package/d3-axis/v/3.0.0) | [LICENSE](public/vendor/licenses/npm/d3-axis/LICENSE) |
| d3-color | 3.1.1 | ISC | [upstream](https://www.npmjs.com/package/d3-color/v/3.1.1) | [LICENSE](public/vendor/licenses/npm/d3-color/LICENSE) |
| d3-format | 3.1.3 | ISC | [upstream](https://www.npmjs.com/package/d3-format/v/3.1.3) | [LICENSE](public/vendor/licenses/npm/d3-format/LICENSE) |
| d3-interpolate | 3.0.2 | ISC | [upstream](https://www.npmjs.com/package/d3-interpolate/v/3.0.2) | [LICENSE](public/vendor/licenses/npm/d3-interpolate/LICENSE) |
| d3-scale | 4.0.2 | ISC | [upstream](https://www.npmjs.com/package/d3-scale/v/4.0.2) | [LICENSE](public/vendor/licenses/npm/d3-scale/LICENSE) |
| d3-selection | 3.0.0 | ISC | [upstream](https://www.npmjs.com/package/d3-selection/v/3.0.0) | [LICENSE](public/vendor/licenses/npm/d3-selection/LICENSE) |
| d3-time | 3.1.1 | ISC | [upstream](https://www.npmjs.com/package/d3-time/v/3.1.1) | [LICENSE](public/vendor/licenses/npm/d3-time/LICENSE) |
| d3-time-format | 4.1.1 | ISC | [upstream](https://www.npmjs.com/package/d3-time-format/v/4.1.1) | [LICENSE](public/vendor/licenses/npm/d3-time-format/LICENSE) |
| internmap | 2.0.3 | ISC | [upstream](https://www.npmjs.com/package/internmap/v/2.0.3) | [LICENSE](public/vendor/licenses/npm/internmap/LICENSE) |
