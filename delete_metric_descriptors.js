async function deleteMetricDescriptor(projectId, metricId) {
  const monitoring = require("@google-cloud/monitoring");
  const client = new monitoring.MetricServiceClient();

  const request = {
    name: client.projectMetricDescriptorPath(projectId, metricId),
  };

  const [result] = await client.deleteMetricDescriptor(request);
  console.log(`Deleted ${metricId}`);
}

const projects = ["xxxxx"];
const list = [
  "custom.googleapis.com/https/request_count_xxxxx",
  "custom.googleapis.com/https/request_count_xxxxx"
];

Promise.all(
  projects.map(async (projectId) => {
    await Promise.all(
      list.map(async (metricId) => {
        deleteMetricDescriptor(projectId, metricId).catch((e) => {
          if (e.details === "The metric '" + metricId + "' does not exist.") {
            console.log("OK, " + metricId + " does not exist");
          } else {
            throw e;
          }
        });
      })
    );
  })
);
