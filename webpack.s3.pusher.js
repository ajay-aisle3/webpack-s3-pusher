const AWS = require('aws-sdk');
const fs = require('fs');
const progress = require('cli-progress');

let s3;
let bar;

function S3PusherPlugin(options) {
  this.bucket = options.bucket;
  this.assets = [];

  if (!options.region) {
    options.region = 'us-west-2';
  }

  if (options.prefix) {
    this.prefix = this.removeSlashes(options.prefix);
  }

  if (options.include) {
    this.include = new RegExp(options.include);
  }

  if (options.exclude) {
    this.exclude = new RegExp(options.exclude);
  }

  if (options.quiet) {
    this.quiet = options.quiet
  }

  if (options.key && options.secret && options.region) {
    AWS.config.update({
      accessKeyId: options.key, 
      secretAccessKey: options.secret, 
      region: options.region
    })  
  }

  s3 = new AWS.S3();

  if (options.remove) {
    this.removePaths(options.remove)
  }
}

S3PusherPlugin.prototype.removePaths = function(paths) {
  var params = {
    Bucket: this.bucket, 
    Delete: {
      Objects: [], 
      Quiet: false
    }
  };

  for (let i in paths) {
    params.Delete.Objects.push({
      Key: paths[i],
    })
  }

  s3.deleteObjects(params, function(err, data) {
    if (err) console.log(err, err.stack); 
  });
};

S3PusherPlugin.prototype.removeSlashes = function(str) {
    return str.replace(/^\/|\/$/g, '');
};

S3PusherPlugin.prototype.upload = function(filename, content) {
  return new Promise((resolve, reject) => {
    let params = {
      Bucket: this.bucket, 
      Key: filename, 
      Body: content
    };

    /**
     * @todo We should use a MIME sniffer on all files.
     */
    if (filename.slice(-3) === 'css') {
      params.ContentType = 'text/css';
    }

    s3.putObject(params, (err, data) => {
      if (err) {
        throw new Error('Could not upload ' + filename + ' to ' + this.bucket + ': ' + err.name + ' - ' + err.message)
      }

      resolve();
    });
  })
};

S3PusherPlugin.prototype.shouldUpload = function(filename) {
  return (!this.include || this.include.test(filename)) && 
    (!this.exclude || !this.exclude.test(filename));
}

S3PusherPlugin.prototype.log = function(message) {
  if (!this.quiet) {
    console.log(message)
  }
}

S3PusherPlugin.prototype.apply = function(compiler) {
  compiler.plugin('emit', (compilation, callback) => {
    for (var filename in compilation.assets) {
      if (this.shouldUpload(filename)) {
        this.assets.push(filename);
      }
    }

    callback();
  });

  compiler.plugin('after-emit', (compilation, cb) => {
    (async () => {
      this.log('\r\n\r\nUploading ' + this.assets.length + ' assets to \'' + this.bucket + '\'...')

      bar = new progress.SingleBar({
          format: 'Progress | {bar} | {percentage}% | {filename}',
          barCompleteChar: '\u2588',
          barIncompleteChar: '\u2591',
          hideCursor: true
      });
   
      bar.start(this.assets.length, 0, {
          filename: "Starting..."
      });

      let c = 1;
      let error = false;

      for (var i in this.assets) {
        // Remove the question mark. 
        // (added by laravel-mix for some assets)
        let filename = this.assets[i].split('?')[0];

        filename = this.removeSlashes(filename)

        let localPath = compiler.outputPath + '/' + filename;
        let remotePath = filename;       

        if (this.prefix) {        
          remotePath = this.prefix + '/' + remotePath;
        }

        await this.upload(remotePath, fs.readFileSync(localPath)).catch(e => {
          error = e
          cb(e)
        }); 

        if (error) {
          return;
        }

        bar.update(c, { filename });
        c++;
      }

      bar.stop();

      this.log('Finished!');
      cb();
    })()
  });
};

module.exports = S3PusherPlugin;