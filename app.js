const monitoring = require("@google-cloud/monitoring");
const fs = require('fs');
const monitoringauth = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));

// Retry function
const retry = async (
  func,
  exitRetryLoop = () => false,
  attempts = 5,
  ...args
) => {
  try {
    return await func(...args);
  } catch (e) {
    const retries = --attempts;
    const shouldExitEarly = exitRetryLoop(e, ...args);

    if (shouldExitEarly === true || retries < 1) {
      throw e;
    }

    return await retry(func, exitRetryLoop, retries, ...args);
  }
};

// Update data function
const updateData = async (
  client,
  metricDescriptor,
  projectId,
  metricType,
  metricTypeRegexp
) => {
  // Populate time series
  const timeSeriesRequest = {
    name: client.projectPath(projectId),
    aggregation: {
      perSeriesAligner: "ALIGN_SUM",
      crossSeriesReducer: "REDUCE_SUM",
      alignmentPeriod: {
        seconds: 60,
      },
      groupByFields: ["resource.label.matched_url_path_rule"],
    },
    filter:
      'metric.type="' +
      metricType +
      '" resource.type="https_lb_rule" resource.label.project_id="' +
      projectId +
      '"',
    interval: {
      startTime: {
        // Limit results to the last 1 minutes
        // -110 seconds due to time difference between datapoint and script run time
        seconds: Date.now() / 1000 - 110,
      },
      endTime: {
        seconds: Date.now() / 1000,
      },
    },
  };

  // Get TimeSeries
  let timeSeriesImported = JSON.stringify(
    await client.listTimeSeries(timeSeriesRequest)
  );
  const timeSeriesImportedAndReplaced = timeSeriesImported.replace(
    /"metricKind":"DELTA"/g,
    '"metricKind":"GAUGE"'
  );
  timeSeriesImported = JSON.parse(timeSeriesImportedAndReplaced)[0];
  console.log("Time series retrieved");

  await Promise.all(
    timeSeriesImported.map(async (timeSeries) => {
      const functionName =
        timeSeries.resource.labels.matched_url_path_rule.substring(1);
      const functionMetricName =
        "custom.googleapis.com/https/request_count_" +
        functionName.toLowerCase();

      const jsonFunctionMetricDescriptor = JSON.stringify(metricDescriptor);
      const replacedFunctionMetricDescriptor = jsonFunctionMetricDescriptor
        .replace(metricTypeRegexp, functionMetricName)
        .replace(
          /"displayName":"Request count"/g,
          '"displayName":"Request count ' + functionName + '"'
        );
      const functionMetricDescriptor = JSON.parse(
        replacedFunctionMetricDescriptor
      );

      // Creates a custom metric descriptor
      const [descriptor] = await client.createMetricDescriptor({
        name: client.projectPath(projectId),
        metricDescriptor: functionMetricDescriptor,
      });
      console.log(`Created custom metric: ${descriptor.type}`);

      // prepare timeSeries data
      const jsonTimeSeries = JSON.stringify(timeSeries);
      const timeSeriesReplaced = jsonTimeSeries.replace(
        metricTypeRegexp,
        functionMetricName
      );
      const functionTimeSeries = JSON.parse(timeSeriesReplaced);
      // custom metrics have to be global
      functionTimeSeries.resource.type = "global";
      // global time series do not support labels
      delete functionTimeSeries.resource.labels;

      await Promise.all(
        functionTimeSeries.points.map(async (point) => {
          point.interval.endTime = point.interval.startTime;
          await retry(async () => {
            try {
              await client.createTimeSeries({
                name: client.projectPath(projectId),
                timeSeries: [
                  {
                    points: [point],
                    metric: functionTimeSeries.metric,
                    resource: functionTimeSeries.resource,
                    metricKind: functionTimeSeries.metricKind,
                    valueType: functionTimeSeries.valueType,
                    metadata: functionTimeSeries.metadata,
                    unit: functionTimeSeries.unit,
                  },
                ],
              });
              console.log(`Done writing time series ${functionMetricName}`);
            } catch (e) {
              if (
                e.details ===
                  "One or more TimeSeries could not be written: One or more points were written more frequently than the maximum sampling period configured for the metric.: timeSeries[0]" ||
                e.details ===
                  "One or more TimeSeries could not be written: Internal error encountered. Please retry after a few seconds. If internal errors persist, contact support at https://cloud.google.com/support/docs.: timeSeries[0]" ||
                e.details ===
                  "One or more TimeSeries could not be written: Points must be written in order. One or more of the points specified had an older end time than the most recent point.: timeSeries[0]"
              ) {
              } else {
                throw e;
              }
            }
          });
        })
      );
    })
  );
};

// Self executing data gathering function
(async function () {
  const client = new monitoring.MetricServiceClient({
    projectId: monitoringauth.project_id,
    credentials: monitoringauth,
  });
  const projectId = monitoringauth.project_id;
  const metricType = "loadbalancing.googleapis.com/https/request_count";
  const metricTypeRegexp = new RegExp(`\\b${metricType}\\b`, "gi");

  // Retrieves a metric descriptor
  const jsonMetricDescriptor = JSON.stringify(
    await client.getMetricDescriptor({
      name: client.projectMetricDescriptorPath(projectId, metricType),
    })
  );
  // Replacing incompatible value of metricKind DELTA to GAUGE
  const replacedMetricDescriptor = jsonMetricDescriptor.replace(
    /"metricKind":"DELTA"/g,
    '"metricKind":"GAUGE"'
  );
  const metricDescriptor = JSON.parse(replacedMetricDescriptor)[0];
  console.log("Metric descriptor retrieved");
  // Removing incompatible data
  delete metricDescriptor.monitoredResourceTypes;
  delete metricDescriptor.metadata;

  let runs = 1;
  let activeRun = false;
  while (runs <= 10) {
    const now = new Date();
    const seconds = now.getSeconds();
    if (seconds % 10 === 0 && activeRun === false) {
      activeRun = true;
      await Promise.all([
        updateData(
          client,
          metricDescriptor,
          projectId,
          metricType,
          metricTypeRegexp
        ),
        await new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      console.log(`==== Run ${runs} finished ====`);
      activeRun = false;
      runs++;
    }
  }
})();
