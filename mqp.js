// chalk and update-notifier are ESM-only; Node >= 22.12 can require() them.
const chalk = require('chalk').default;
const fs = require('fs');
const daemon = require('daemon');
const path = require('path');
const update = require('./update');
const updateNotifier = require('update-notifier').default;
const pkg = require('./package.json');

const notifier = updateNotifier({
  pkg,
  updateCheckInterval: 0,
});
if (notifier.update) {
  console.log(`Update available ${chalk.dim(notifier.update.current)}${chalk.reset(' → ')}${chalk.green(notifier.update.latest)}`);
}

function getRunningPid(callback) {
  fs.readFile(`${__dirname}/pidfile`, {
    encoding: 'utf-8',
  }, (err, pid) => {
    if (err) {
      return callback(err);
    }

    try {
      process.kill(parseInt(pid, 10), 0);
      callback(null, parseInt(pid, 10));
    } catch (e) {
      callback(e);
    }
  });
}

function startDaemon() {
  // cwd has to be passed explicitly: daemon@1.1.0 defaults it to the
  // process.cwd function itself, which child_process.spawn rejects.
  daemon.daemon(`${__dirname}/start.js`, '--daemon', {
    cwd: process.cwd(),
    stdout: fs.openSync(path.join(process.cwd(), 'log.txt'), 'a'),
    stderr: fs.openSync(path.join(process.cwd(), 'log.txt'), 'a'),
  });
}

function waitForExit(pid, timeout, callback) {
  const started = Date.now();
  (function check() {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if (e.code !== 'EPERM') {
        callback(true);
        return;
      }
    }
    if (Date.now() - started >= timeout) {
      callback(false);
      return;
    }
    setTimeout(check, 100);
  })();
}

// Minimal "tail -F": polls the file size every `interval` ms and emits every
// line appended after startup (replacement for the deprecated file-tail module).
function tailFile(file, onLine, interval) {
  let size = null;
  let rest = '';
  let reading = false;

  function poll() {
    if (reading) return;
    fs.stat(file, (err, stats) => {
      if (err) {
        // File doesn't exist (yet) or was removed: print everything once it shows up
        if (err.code === 'ENOENT') {
          size = 0;
          rest = '';
        }
        return;
      }
      if (size === null || stats.size < size) {
        // First poll or file got truncated: continue from the current end
        size = stats.size;
        rest = '';
        return;
      }
      if (stats.size === size || reading) return;

      reading = true;
      const stream = fs.createReadStream(file, {
        encoding: 'utf-8',
        start: size,
        end: stats.size - 1,
      });
      size = stats.size;
      stream.on('data', chunk => {
        const lines = (rest + chunk).split('\n');
        rest = lines.pop();
        lines.forEach(line => onLine(line));
      });
      stream.on('error', () => { reading = false; });
      stream.on('close', () => { reading = false; });
    });
  }

  poll();
  setInterval(poll, interval || 100);
}

switch (process.argv[2]) {
  case 'start':
    getRunningPid((err, pid) => {
      if (!err) {
        console.log('Musiqpad is already running!');
      } else {
        console.log('\nStarting musiqpad');
        console.log(`  "${chalk.yellow.bold('npm stop')}" to stop the musiqpad server`);
        console.log(`  "${chalk.yellow.bold('npm run log')}" to view server output`);
        console.log(`  "${chalk.yellow.bold('npm restart')}" to restart musiqpad`);

        // Spawn a new musiqpad daemon process, might need some more settings but I'm waiting for the new config storage for that.
        startDaemon();
      }
    });

    break;
  case 'stop':
    getRunningPid((err, pid) => {
      if (!err) {
        process.kill(pid, 'SIGTERM');
        console.log('Stopping musiqpad!');
      } else {
        console.log('Musiqpad is already stopped.');
      }
    });

    break;
  case 'restart':
    getRunningPid((err, pid) => {
      if (!err) {
        process.kill(pid, 'SIGTERM');
        console.log('\nRestarting musiqpad');
        // The old process needs a moment to shut down; a new one started before
        // that would see it in the pidfile (or find the ports in use) and quit.
        waitForExit(pid, 10000, (exited) => {
          if (exited) {
            startDaemon();
          } else {
            console.log(`musiqpad could not be restarted, the old process (${pid}) is still running.`);
          }
        });
      } else {
        console.log('musiqpad could not be restarted, as a running instance could not be found.');
      }
    });

    break;
  case 'log': {
    console.log('Type Ctrl-C to exit');
    tailFile('./log.txt', line => {
      console.log(line);
    });
    break;
  }
  case 'update':
    getRunningPid((err, pid) => {
      if (!err) {
        process.kill(pid, 'SIGTERM');
        console.log('Stopping musiqpad!');
      }

      update();
    });

    break;
  default:
    console.log('Welcome to musiqpad!');
    console.log('Usage: npm run {start|stop|restart|log|update}');
    // TODO: Add infos for each cmd
    break;
}
