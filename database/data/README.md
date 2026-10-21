# UCI Online Retail Dataset

- Source: https://archive.ics.uci.edu/dataset/352/online+retail
- Download URL: https://archive.ics.uci.edu/static/public/352/online+retail.zip
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Attribution: Chen, D. (2015). Online Retail. UCI Machine Learning Repository. https://doi.org/10.24432/C5BW33
- Archive: `online-retail.zip` (22.6 MB)

The archive is the primary analytics dataset for the application. It contains 541,909 invoice-line records from a UK-based online retailer. Cancellation invoices are retained and represented by negative line revenue where quantity is negative. Customer IDs are nullable because the source omits them for some records.

Import from the backend directory:

```sh
npm run data:import -- --dry-run
npm run data:import
```

The importer streams the workbook, records source-row numbers for idempotence, stores source/license attribution in PostgreSQL, and skips a repeat import when the archive checksum is unchanged.