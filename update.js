const tar = require('tar');
const yesno = require('yesno');
const exec = require('child_process').exec;
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const REPO = 'musiqpad/mqp-server';

// Downloads the source tarball of the given tag from GitHub and extracts it
// over the current directory (without the top level "mqp-server-<tag>" folder)
function download(tag) {
  fetch(`https://github.com/${REPO}/archive/${encodeURIComponent(tag)}.tar.gz`)
    .then((res) => {
      if (!res.ok) throw new Error(`Unexpected response ${res.status} ${res.statusText}`);
      return pipeline(Readable.fromWeb(res.body), tar.x({ cwd: process.cwd(), strip: 1 }));
    })
    .then(() => {
      console.log('Download finished, now (re)installing dependencies');
      console.log('This step might take some time ...');
      exec('npm install', { cwd: (process.cwd()) }, function (error, stdout, stderr) {
        if (error) {
          console.error(`exec error: ${error}`);
          return;
        } else {
          console.log('Succesfully installed all dependencies of musiqpad');
          process.exit();
        }
      });
    })
    .catch((err) => {
      console.log('Error downloading the update: ' + err.message);
      process.exit();
    });
}

module.exports = function update() {
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: {
      'User-Agent': 'mqp-server',
    },
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Unexpected response ${res.status} ${res.statusText}`);
      return res.json();
    })
    .then((data) => yesno({
      question: 'This will overide all existing code exept new files and modules. Do you want to continue? (y/N)',
      defaultValue: false,
    }).then((ok) => {
      if (ok) {
        console.log('Now updating to latest version (' + data.tag_name + ')!');
        download(data.tag_name);
      } else
        process.exit();
    }))
    .catch((err) => {
      console.log('Error getting the latest musiqpad version: ' + err.message);
    });
};
