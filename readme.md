This project is designed for transforming certain metric (in this case loadbalancing.googleapis.com/https/request_count) from google monitoring to a custom metric so it could be used as a target for Kubernetes Horizontal Pod Autoscaler

This script is designed to run with 'every 1 minute' schedule, it internally performs several runs to cover at least 1 minute and ignores errors related to 'duplicate' descriptors and so on.

## Prepare local environment

Install packages
    
    nvm install 12
    npm install

Set an environment variable with a path to your auth key

    export GOOGLE_APPLICATION_CREDENTIALS="KEY_PATH"

## Run the script
    
    node app.js

## Note

If you'd like to delete certain custom descriptors, use script delete_metric_descriptors.js
