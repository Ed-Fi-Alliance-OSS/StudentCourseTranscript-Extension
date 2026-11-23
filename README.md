# StudentCourseTranscript-Extension

Official extension targeting Data Standard 6, with addition of a new
`StudentCourseTranscript` entity.

## Developer's Notes

When editing in VS Code, open the `package` folder in a workspace along withe
the `Ed-Fi-Model` folder, which should be checked out at branch `DS-6.2-ME-3.x`.

To test that your `.metaed` files build without error or waning, either use the
Build button in MetaEd, or run the local command line version (requires
Node.js):

```shell
# Install Node.js packages
npm i

# Run the build
npm start

# Inspect errors at the command line
```

The "on pull request" GitHub action executes the same command for every pull
request.

## Legal Information

Copyright (C) 2026 Ed-Fi Alliance, LLC. All rights reserved.

Licensed under the [Apache License, Version 2.0](sLICENSE) (the "License").

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

See [NOTICES](NOTICES.md) for additional copyright and license notifications.
