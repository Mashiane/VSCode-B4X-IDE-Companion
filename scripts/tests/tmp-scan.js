const { scanB4aProject } = require('../dist/src/b4aProjectScanner');

scanB4aProject('c:/b4a/b4a-vscode-intellisense/B4A/B4XDaisyUIKitDemo.b4a')
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
