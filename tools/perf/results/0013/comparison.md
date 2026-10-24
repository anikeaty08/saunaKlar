# 0013: e-mail lookup and customer search

Median ms, full scale (500 resellers, 200k customers, 1M configurations), app_tenant as the largest reseller.

| Query | before | after | before, rpc 1.1 | after, rpc 1.1 |
|---|---:|---:|---:|---:|
| configurations: admin list, page 1 | 9.66 | 8.38 | 7.62 | 7.91 |
| configurations: admin list, page 200 | 8.71 | 7.86 | 8.02 | 10.40 |
| configurations: customer list | 11.29 | 9.96 | 5.39 | 8.55 |
| requests: admin list, page 1 | 99.61 | 82.45 | 6.10 | 9.00 |
| requests: admin list, page 200 | 88.50 | 62.65 | 6.11 | 6.89 |
| requests: status SUBMITTED | 21.90 | 21.27 | 6.24 | 9.85 |
| requests: search "virtanen" | 22.25 | 31.39 | 15.52 | 47.72 |
| requests: search one e-mail (rare) | 215 (old SQL, measured separately) | 70.95 | 215 (old SQL, measured separately) | 74.04 |
| requests: customer list | 2.73 | 3.43 | 1.83 | 1.75 |
| customers: list, page 1 | 0.80 | 0.57 | 0.53 | 0.71 |
| customers: list, page 400 | 6.68 | 5.95 | 0.47 | 0.54 |
| customers: search "anna" (common) | 33.36 | 15.62 | 24.80 | 18.78 |
| customers: search one e-mail (rare) | 45.09 | 1.51 | 27.14 | 1.92 |
| customers: search "zzqx" (no match) | 31.80 | 0.64 | 23.43 | 0.46 |
| auth: login lookup by e-mail | 13.02 | 0.13 | 23.26 | 0.12 |
| analytics: totals 30 d | 9.57 | 6.27 | 8.93 | 6.07 |
| analytics: totals 365 d | 74.17 | 64.08 | 65.83 | 67.06 |
| analytics: by status 365 d | 14.62 | 10.16 | 13.32 | 20.40 |
| analytics: daily 30 d | 8.22 | 6.11 | 5.78 | 5.76 |
| analytics: daily 365 d | 72.14 | 79.86 | 70.63 | 75.14 |
| analytics: top saunas 30 d | 41.86 | 28.74 | 26.29 | 33.20 |
| analytics: top saunas 365 d | 150.70 | 119.39 | 133.34 | 185.55 |
| share links of a configuration (view counts) | 0.30 | 0.34 | 0.38 | 0.29 |
| catalog: storefront listing | 3.60 | 3.94 | 2.79 | 2.93 |
| manufacturer: reseller list (500) | 54.43 | 61.83 | 59.44 | 85.34 |
| manufacturer: analytics 30 d | 173.54 | 147.22 | 121.19 | 139.07 |
