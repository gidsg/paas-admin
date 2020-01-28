// tslint:disable-next-line:no-submodule-imports
import parse from 'csv-parse/lib/sync';
import jwt from 'jsonwebtoken';
import lodash from 'lodash';
import moment from 'moment';
import nock from 'nock';

import { spacesMissingAroundInlineElements } from '../../layouts/react-spacing.test';
import * as cf from '../../lib/cf/cf.test.data';
import { org as defaultOrg, v3Org as defaultOrgv3 } from '../../lib/cf/test-data/org';
import { wrapResources, wrapV3Resources } from '../../lib/cf/test-data/wrap-resources';
import { testable as t, viewOrganizationsReport } from './controllers';

import { createTestContext } from '../app/app.test-helpers';
import { IContext } from '../app/context';
import { Token } from '../auth';

import { config } from '../app/app.test.config';
import * as reports from '../reports';

describe('organisations report helpers', () => {
  let nockCF: nock.Scope;
  const tokenKey = 'secret';

  const time = Math.floor(Date.now() / 1000);
  const rawToken = {user_id: 'uaa-id-253', scope: [], origin: 'uaa', exp: (time + (24 * 60 * 60))};
  const accessToken = jwt.sign(rawToken, tokenKey);

  const ctx: IContext = createTestContext({
    token: new Token(accessToken, [tokenKey]),
  });

  beforeEach(() => {
    nock.cleanAll();

    nockCF = nock(ctx.app.cloudFoundryAPI);
  });

  afterEach(() => {
    nockCF.done();

    nock.cleanAll();
  });

  it('trialExpiryDate should compute trial expiry correctly', () => {
    const creationDate = new Date('2019-08-01T16:25:59.254Z');
    const beforeExpiredDate = new Date('2019-10-29T17:25:59.254Z');
    const afterExpiredDate = new Date('2019-10-31T17:25:59.254Z');

    expect(
      t.trialExpiryDate(creationDate).getTime(),
    ).toBeGreaterThan(beforeExpiredDate.getTime());

    expect(
      t.trialExpiryDate(creationDate).getTime(),
    ).toBeLessThan(afterExpiredDate.getTime());
  });

  it('filterRealOrgs should filter out tests and admin', () => {
    const orgs = [
      lodash.merge(defaultOrgv3(), {name: 'govuk-doggos' }),
      lodash.merge(defaultOrgv3(), {name: 'admin' }),
      lodash.merge(defaultOrgv3(), {name: 'ACC-123' }),
      lodash.merge(defaultOrgv3(), {name: 'BACC-123' }),
      lodash.merge(defaultOrgv3(), {name: 'CATS-123' }),
      lodash.merge(defaultOrgv3(), {name: 'department-for-coffee' }),
      lodash.merge(defaultOrgv3(), {name: 'SMOKE-' }),
    ];

    const filteredOrgs = t.filterRealOrgs(orgs);

    expect(filteredOrgs.length).toEqual(2);
    expect(filteredOrgs[0].name).toEqual('govuk-doggos');
    expect(filteredOrgs[1].name).toEqual('department-for-coffee');
  });

  it('filterTrialOrgs should filter out billable orgs and sort asc', () => {
    const trialGUID = 'trial-guid';
    const paidGUID = 'expensive-guid';

    const orgs = [
      lodash.merge(defaultOrgv3(), {
        created_at: moment().toDate(),
        name: '1-trial-org',
        relationships: {quota: {data: { guid: trialGUID }}},
      }),
      lodash.merge(defaultOrgv3(), {
        created_at: moment().toDate(),
        name: '1-paid-org',
        relationships: {quota: {data: { guid: paidGUID }}},
      }),
      lodash.merge(defaultOrgv3(), {
        created_at: moment().subtract(1, 'days').toDate(),
        name: '2-trial-org',
        relationships: {quota: {data: { guid: trialGUID }}},
      }),
      lodash.merge(defaultOrgv3(), {
        created_at: moment().subtract(1, 'days').toDate(),
        name: '2-paid-org',
        relationships: {quota: {data: { guid: paidGUID }}},
      }),
    ];

    const trialOrgs = t.filterTrialOrgs(trialGUID, orgs);

    expect(trialOrgs.length).toEqual(2);
    expect(trialOrgs[0].name).toEqual('2-trial-org');
    expect(trialOrgs[1].name).toEqual('1-trial-org');
  });

  it('filterBillableOrgs should filter out trial orgs and sort desc', () => {
    const trialGUID = 'trial-guid';
    const paidGUID = 'expensive-guid';

    const orgs = [
      lodash.merge(defaultOrgv3(), {
        created_at: moment().toDate(),
        relationships: {quota: {data: { guid: trialGUID }}},
        name: '1-trial-org',
      }),
      lodash.merge(defaultOrgv3(), {
        created_at: moment().toDate(),
        relationships: {quota: {data: { guid: paidGUID }}},
        name: '1-paid-org',
      }),
      lodash.merge(defaultOrgv3(), {
        created_at: moment().subtract(1, 'days').toDate(),
        relationships: {quota: {data: { guid: trialGUID }}},
        name: '2-trial-org',
      }),
      lodash.merge(defaultOrgv3(), {
        created_at: moment().subtract(1, 'days').toDate(),
        relationships: {quota: {data: { guid: paidGUID }}},
        name: '2-paid-org',
      }),
    ];

    const billableOrgs = t.filterBillableOrgs(trialGUID, orgs);

    expect(billableOrgs.length).toEqual(2);
    expect(billableOrgs[0].name).toEqual('1-paid-org');
    expect(billableOrgs[1].name).toEqual('2-paid-org');
  });

  it('should render the page correctly', async () => {
    const baseQuota = cf.organizationQuota;
    const aQuota = (name: string, quotaGUID: string) => lodash.merge(
      JSON.parse(baseQuota), {
        entity: { name },
        metadata: { guid: quotaGUID },
      },
    );

    const trialGUID = 'default';
    const cheapGUID = 'cheap-guid';
    const expensiveGUID = 'expensive-guid';

    const orgs = [
      lodash.merge(defaultOrgv3(), {
        guid: 'current-trial-org', created_at: moment().toDate(),
        relationships: {quota: {data: { guid: trialGUID }}},
        name: 'current-trial-org',
      }),
      lodash.merge(defaultOrgv3(), {
        guid: 'expiring-trial-org',
        created_at: moment().subtract(100, 'days').toDate(),
        relationships: {quota: {data: { guid: trialGUID }}},
        name: 'expiring-trial-org',
      }),
      lodash.merge(defaultOrgv3(), {
        guid: 'cheap-org',
        created_at: moment().subtract(365, 'days').toDate(),
        relationships: {quota: {data: { guid: cheapGUID }}},
        name: 'cheap-org',
      }),
      lodash.merge(defaultOrgv3(), {
        guid: 'expensive-org',
        created_at: moment().subtract(730, 'days').toDate(),
        relationships: {quota: {data: { guid: expensiveGUID }}},
        name: 'expensive-org',
      }),
    ];

    nockCF
      .get(`/v2/quota_definitions?q=name:${trialGUID}`)
      .reply(200, JSON.stringify(lodash.merge(
        JSON.parse(cf.organizationQuotas),
        {resources: [aQuota('Trial', trialGUID)]},
      )))

      .get(`/v2/quota_definitions/${trialGUID}`)
      .reply(200, JSON.stringify(aQuota('Trial', trialGUID)))

      .get(`/v2/quota_definitions/${cheapGUID}`)
      .reply(200, JSON.stringify(aQuota('Cheap', cheapGUID)))

      .get(`/v2/quota_definitions/${expensiveGUID}`)
      .reply(200, JSON.stringify(aQuota('Expensive', expensiveGUID)))

      .get('/v3/organizations')
      .reply(200, JSON.stringify(wrapV3Resources(...orgs)))
    ;

    const response = await viewOrganizationsReport(ctx, {});

    // When trial accounts are expiring
    expect(response.body).toContain('Expired 10 days ago');
    expect(response.body).toContain('Expires in 3 months');

    // When billabe accounts were created approximately
    expect(response.body).toContain('Created a year ago');
    expect(response.body).toContain('Created 2 years ago');

    // Should show the quota names
    expect(response.body).toContain('Trial');
    expect(response.body).toContain('Cheap');
    expect(response.body).toContain('Expensive');

    // Should show the org names
    expect(response.body).toContain('current-trial-org');
    expect(response.body).toContain('expiring-trial-org');
    expect(response.body).toContain('cheap-org');
    expect(response.body).toContain('expensive-org');
  });

  it('should return an error when the default quota is not found', async () => {
    const quotaDefinitionsResponse = JSON.parse(cf.organizationQuotas);
    quotaDefinitionsResponse.resources = [];

    nockCF
      .get(`/v2/quota_definitions?q=name:default`)
      .reply(200, JSON.stringify(quotaDefinitionsResponse))
    ;

    try {
      await viewOrganizationsReport(ctx, {});
    } catch (e) {
      expect(e.message).toContain('Could not find default quota');
    }
  });
});

describe('cost report test suite', () => {
  let nockCF: nock.Scope;
  let nockBilling: nock.Scope;

  const ctx: IContext = createTestContext();

  const defaultBillableEvent = {
    eventGUID: '', eventStart: new Date(), eventStop: new Date(),
    resourceGUID: '', resourceName: '', resourceType: '', orgGUID: '',
    spaceGUID: '', quotaGUID: '', spaceName: '', planGUID: '', numberOfNodes: 0, memoryInMB: 0,
    storageInMB: 0,
    price: {
      incVAT:  0,
      exVAT:   0,
      details: [],
    },
  };

  beforeEach(() => {
    nock.cleanAll();

    nockCF = nock(ctx.app.cloudFoundryAPI);
    nockBilling = nock(config.billingAPI);
  });

  afterEach(() => {
    nockCF.done();
    nockBilling.done();

    nock.cleanAll();
  });

  it('should report zero for zero billables', async () => {
    // tslint:disable:max-line-length
    nockCF
    .get('/v2/organizations')
    .times(1)
    .reply(200, JSON.stringify(wrapResources(defaultOrg())))

    .get('/v2/quota_definitions/ORG-QUOTA-GUID')
    .times(1)
    .reply(200, cf.organizationQuota)
    ;
    const rangeStart = moment().startOf('month').format('YYYY-MM-DD');
    const period     = moment(rangeStart).format('MMMM YYYY');

    nockBilling
      .get('/billable_events')
      .query(true)
      .reply(200, '[]')
    ;

    const response = await reports.viewCostReport(ctx, {rangeStart});

    expect(response.body)
      .toContain(`Billables for ${period}`);

    expect(response.body)
      .toContain(`Billables by organisation for ${period}`);

    expect(response.body)
      .toContain(`Billables by quota for ${period}`);

    expect(response.body)
      .toContain('the-system_domain-org-name'); // the org name

    expect(response.body)
      .toContain('name-1996'); // the quota

    expect((response.body || '').toString().match(/£0[.]00/g))
      .toHaveLength(6);

    expect(spacesMissingAroundInlineElements(response.body as string)).toHaveLength(0);
  });

  it('should report some billables but not attribute to org', async () => {
    const rangeStart = moment().startOf('month').format('YYYY-MM-DD');

    // tslint:disable:max-line-length
    nockCF
    .get('/v2/organizations')
    .times(1)
    .reply(200, JSON.stringify(wrapResources(defaultOrg())))

    .get('/v2/quota_definitions/ORG-QUOTA-GUID')
    .times(1)
    .reply(200, cf.organizationQuota)
    ;

    // this test has billable events but no billable events attributable to an
    // org. expected response is to:
    // 1 billable event
    // 0 billable events for any org or quota
    nockBilling
      .get('/billable_events')
      .query(true)
      .reply(200, `[{
        "event_guid": "fecc9eb5-b027-42fe-ba1f-d90a0474b620",
        "event_start": "2018-04-20T14:36:09+00:00",
        "event_stop": "2018-04-20T14:45:46+00:00",
        "resource_guid": "a585feac-32a1-44f6-92e2-cdb1377e42f4",
        "resource_name": "api-availability-test-app",
        "resource_type": "app",
        "org_guid": "7f9c0e11-e7f1-41d7-9d3f-cb9d05110f9e",
        "space_guid": "2e030634-2640-4535-88ed-e67235b52ceb",
        "plan_guid": "f4d4b95a-f55e-4593-8d54-3364c25798c4",
        "quota_definition_guid": "3f2dd80c-7dfb-4e7f-b8a9-406b0b8abfa3",
        "number_of_nodes": 1,
        "memory_in_mb": 64,
        "storage_in_mb": 0,
        "price": {
          "ex_vat": "0.02",
          "inc_vat": "0.024",
          "details": [
            {
              "name": "instance",
              "start": "2018-04-20T14:36:09+00:00",
              "stop": "2018-04-20T14:45:46+00:00",
              "plan_name": "app",
              "ex_vat": "0.01",
              "inc_vat": "0.012",
              "vat_rate": "0.2",
              "vat_code": "Standard",
              "currency_code": "GBP"
            },
            {
              "name": "platform",
              "start": "2018-04-20T14:36:09+00:00",
              "stop": "2018-04-20T14:45:46+00:00",
              "plan_name": "app",
              "ex_vat": "0.01",
              "inc_vat": "0.012",
              "vat_rate": "0.2",
              "vat_code": "Standard",
              "currency_code": "GBP"
            }
          ]
        }
      }]`)
    ;

    const response = await reports.viewCostReport(ctx, {rangeStart});

    expect((response.body || '').toString().match(/£0[.]02/g))
      .toHaveLength(2);

    expect((response.body || '').toString().match(/£0[.]00/g))
      .toHaveLength(4);

    expect(spacesMissingAroundInlineElements(response.body as string)).toHaveLength(0);
  });

  it('should filter billable events by service plan', async () => {
    const rangeStart = moment().startOf('month').format('YYYY-MM-DD');

    // tslint:disable:max-line-length
    nockCF
    .get('/v2/organizations')
    .times(2)
    .reply(200, JSON.stringify(wrapResources(defaultOrg())))

    .get('/v2/quota_definitions/ORG-QUOTA-GUID')
    .times(2)
    .reply(200, cf.organizationQuota)
    ;

    nockBilling
      .get('/billable_events')
      .query(true)
      .times(2)
      .reply(200, `[{
        "event_guid": "fecc9eb5-b027-42fe-ba1f-d90a0474b620",
        "event_start": "2018-04-20T14:36:09+00:00",
        "event_stop": "2018-04-20T14:45:46+00:00",
        "resource_guid": "a585feac-32a1-44f6-92e2-cdb1377e42f4",
        "resource_name": "api-availability-test-app",
        "resource_type": "app",
        "org_guid": "a7aff246-5f5b-4cf8-87d8-f316053e4a20",
        "space_guid": "2e030634-2640-4535-88ed-e67235b52ceb",
        "plan_guid": "f4d4b95a-f55e-4593-8d54-3364c25798c4",
        "quota_definition_guid": "ORG-QUOTA-GUID",
        "number_of_nodes": 1,
        "memory_in_mb": 64,
        "storage_in_mb": 0,
        "price": {
          "ex_vat": "1337.13",
          "inc_vat": "1337.00",
          "details": [
            {
              "name": "instance",
              "start": "2018-04-20T14:36:09+00:00",
              "stop": "2018-04-20T14:45:46+00:00",
              "plan_name": "matching plan",
              "ex_vat": "1337.13",
              "inc_vat": "1337.00",
              "vat_rate": "0.2",
              "vat_code": "Standard",
              "currency_code": "GBP"
            }
          ]
        }
      }]`);

    const firstResponse = await reports.viewCostReport(ctx, {rangeStart, service: 'matching plan'});
    expect((firstResponse.body || '').toString()).toMatch(/£1337\.13/);

    expect(spacesMissingAroundInlineElements(firstResponse.body as string)).toHaveLength(0);

    const secondResponse = await reports.viewCostReport(ctx, {rangeStart, service: 'non-matching plan'});
    expect((secondResponse.body || '').toString()).not.toMatch(/£1337\.13/);
    expect((secondResponse.body || '').toString()).toMatch(/£0\.00/);

    expect(spacesMissingAroundInlineElements(secondResponse.body as string)).toHaveLength(0);
  });

  it('should report some billables and attribute to org', async () => {
    const rangeStart = moment().startOf('month').format('YYYY-MM-DD');

    // tslint:disable:max-line-length
    nockCF
    .get('/v2/organizations')
    .times(1)
    .reply(200, JSON.stringify(wrapResources(defaultOrg())))

    .get('/v2/quota_definitions/ORG-QUOTA-GUID')
    .times(1)
    .reply(200, cf.organizationQuota)
    ;

    // this test has billable events but no billable events attributable to an
    // org. expected response is to:
    // 1 billable event
    // 1 billable events for the org and the quota
    nockBilling
      .get('/billable_events')
      .query(true)
      .reply(200, `[{
        "event_guid": "fecc9eb5-b027-42fe-ba1f-d90a0474b620",
        "event_start": "2018-04-20T14:36:09+00:00",
        "event_stop": "2018-04-20T14:45:46+00:00",
        "resource_guid": "a585feac-32a1-44f6-92e2-cdb1377e42f4",
        "resource_name": "api-availability-test-app",
        "resource_type": "app",
        "org_guid": "a7aff246-5f5b-4cf8-87d8-f316053e4a20",
        "space_guid": "2e030634-2640-4535-88ed-e67235b52ceb",
        "plan_guid": "f4d4b95a-f55e-4593-8d54-3364c25798c4",
        "quota_definition_guid": "ORG-QUOTA-GUID",
        "number_of_nodes": 1,
        "memory_in_mb": 64,
        "storage_in_mb": 0,
        "price": {
          "ex_vat": "0.02",
          "inc_vat": "0.024",
          "details": [
            {
              "name": "instance",
              "start": "2018-04-20T14:36:09+00:00",
              "stop": "2018-04-20T14:45:46+00:00",
              "plan_name": "app",
              "ex_vat": "0.01",
              "inc_vat": "0.012",
              "vat_rate": "0.2",
              "vat_code": "Standard",
              "currency_code": "GBP"
            },
            {
              "name": "platform",
              "start": "2018-04-20T14:36:09+00:00",
              "stop": "2018-04-20T14:45:46+00:00",
              "plan_name": "app",
              "ex_vat": "0.01",
              "inc_vat": "0.012",
              "vat_rate": "0.2",
              "vat_code": "Standard",
              "currency_code": "GBP"
            }
          ]
        }
      }]`)
    ;

    const response = await reports.viewCostReport(ctx, {rangeStart});

    expect((response.body || '').toString().match(/£0[.]02/g))
      .toHaveLength(6);

    expect(spacesMissingAroundInlineElements(response.body as string)).toHaveLength(0);
  });

  it('empty sumRecords', async () => {
    const summed = reports.sumRecords([]);
    expect(summed.incVAT).toEqual(0);
    expect(summed.exVAT).toEqual(0);
  });

  it('n sumRecords', async () => {
    const summed = reports.sumRecords([
      {...defaultBillableEvent, price: {incVAT: 10, exVAT: 11, details: []}},
      {...defaultBillableEvent, price: {incVAT: 5.5, exVAT: 5.5, details: []}},
    ]);
    expect(summed.incVAT).toEqual(15.5);
    expect(summed.exVAT).toEqual(16.5);
  });

  it('empty createOrgCostRecord', async () => {
    const records = reports.createQuotaCostRecords([]);
    expect(records).toHaveLength(0);
  });

  it('n createOrgCostRecord', async () => {
    const quotaRecords = reports.createQuotaCostRecords([
      {
        orgGUID: 'oa',
        orgName: 'oa',

        quotaGUID: 'qa',
        quotaName: 'qa',

        incVAT: 10,
        exVAT:  10,
      },
      {
        orgGUID: 'ob',
        orgName: 'ob',

        quotaGUID: 'qa',
        quotaName: 'qa',

        incVAT: 2.5,
        exVAT:  3.5,
      },
      {
        orgGUID: 'oc',
        orgName: 'oc',

        quotaGUID: 'qb',
        quotaName: 'qb',

        incVAT: 2.5,
        exVAT:  3.5,
      },
    ]);

    expect(quotaRecords).toContainEqual({
      quotaGUID: 'qa',
      quotaName: 'qa',

      incVAT: 12.5,
      exVAT:  13.5,
    });

    expect(quotaRecords).toContainEqual({
      quotaGUID: 'qb',
      quotaName: 'qb',

      incVAT: 2.5,
      exVAT:  3.5,
    });
  });

  it('zero aggregateBillingEvents', async () => {
    const events = reports.aggregateBillingEvents([]);
    expect(events).toEqual({});
  });

  it('n aggregateBillingEvents', async () => {
    const a1 = {...defaultBillableEvent, orgGUID: 'a', price: {incVAT: 1, exVAT: 2, details: []}};
    const a2 = {...defaultBillableEvent, orgGUID: 'a', price: {incVAT: 1, exVAT: 2, details: []}};
    const b1 = {...defaultBillableEvent, orgGUID: 'b', price: {incVAT: 1, exVAT: 2, details: []}};

    const events = reports.aggregateBillingEvents([a1, a2, b1]);
    expect(Object.keys(events)).toContain('a');
    expect(Object.keys(events)).toContain('b');

    expect(events.a).toHaveLength(2);
    expect(events.b).toHaveLength(1);
  });

  it('zero createOrgCostRecords', async () => {
    const records = reports.createOrgCostRecords([], {}, {});
    expect(records).toEqual([]);
  });

  it('orgs but no billable events createOrgCostRecords', async () => {
    const records = reports.createOrgCostRecords(
      [
        {
          entity: {
            app_events_url: '', auditors_url: '', billing_enabled: true,
            billing_managers_url: '', domains_url: '', managers_url: '',
            private_domains_url: '', quota_definition_url: '', users_url: '',
            space_quota_definitions_url: '', spaces_url: '', status: '',
            quota_definition_guid: 'quota-a',
            name: 'Org a',
          },
          metadata: {
            url: '', created_at: '', updated_at: '',
            guid: 'org-a',
          },
        },
      ],
      {
        'org-a': {
          entity: {
            app_instance_limit: 0, app_task_limit: 0, instance_memory_limit: 0,
            memory_limit: 0, name: 'Quota a', non_basic_services_allowed: true,
            total_private_domains: 0, total_reserved_route_ports: 0,
            total_routes: 0, total_service_keys: 0, total_services: 0,
            trial_db_allowed: true,
          },
          metadata: {
            url: '', created_at: '', updated_at: '',
            guid: 'quota-a',
          },
        },
      },
      {
        'quota-a': [],
      },
    );

    expect(records).toContainEqual({
      orgGUID: 'org-a',
      orgName: 'Org a',

      quotaGUID: 'quota-a',
      quotaName: 'Quota a',

      incVAT: 0,
      exVAT:  0,
    });
  });

  it('orgs and some billable events createOrgCostRecords', async () => {
    const records = reports.createOrgCostRecords(
      [
        {
          entity: {
            app_events_url: '', auditors_url: '', billing_enabled: true,
            billing_managers_url: '', domains_url: '', managers_url: '',
            private_domains_url: '', quota_definition_url: '', users_url: '',
            space_quota_definitions_url: '', spaces_url: '', status: '',
            quota_definition_guid: 'quota-a',
            name: 'Org a',
          },
          metadata: {
            url: '', created_at: '', updated_at: '',
            guid: 'org-a',
          },
        },
        {
          entity: {
            app_events_url: '', auditors_url: '', billing_enabled: true,
            billing_managers_url: '', domains_url: '', managers_url: '',
            private_domains_url: '', quota_definition_url: '', users_url: '',
            space_quota_definitions_url: '', spaces_url: '', status: '',
            quota_definition_guid: 'quota-a',
            name: 'Org b',
          },
          metadata: {
            url: '', created_at: '', updated_at: '',
            guid: 'org-b',
          },
        },
      ],
      {
        'org-a': {
          entity: {
            app_instance_limit: 0, app_task_limit: 0, instance_memory_limit: 0,
            memory_limit: 0, name: 'Quota a', non_basic_services_allowed: true,
            total_private_domains: 0, total_reserved_route_ports: 0,
            total_routes: 0, total_service_keys: 0, total_services: 0,
            trial_db_allowed: true,
          },
          metadata: {
            url: '', created_at: '', updated_at: '',
            guid: 'quota-a',
          },
        },
        'org-b': {
          entity: {
            app_instance_limit: 0, app_task_limit: 0, instance_memory_limit: 0,
            memory_limit: 0, name: 'Quota a', non_basic_services_allowed: true,
            total_private_domains: 0, total_reserved_route_ports: 0,
            total_routes: 0, total_service_keys: 0, total_services: 0,
            trial_db_allowed: true,
          },
          metadata: {
            url: '', created_at: '', updated_at: '',
            guid: 'quota-a',
          },
        },
      },
      {
        'org-a': [
          {...defaultBillableEvent, orgGUID: 'b', price: {incVAT: 1, exVAT: 2, details: []}},
          {...defaultBillableEvent, orgGUID: 'b', price: {incVAT: 1.5, exVAT: 2.5, details: []}},
        ],
        'org-b': [{...defaultBillableEvent, orgGUID: 'b', price: {incVAT: 1, exVAT: 2.5, details: []}}],
      },
    );

    expect(records).toContainEqual({
      orgGUID: 'org-a',
      orgName: 'Org a',

      quotaGUID: 'quota-a',
      quotaName: 'Quota a',

      incVAT: 2.5,
      exVAT:  4.5,
    });

    expect(records).toContainEqual({
      orgGUID: 'org-b',
      orgName: 'Org b',

      quotaGUID: 'quota-a',
      quotaName: 'Quota a',

      incVAT: 1,
      exVAT:  2.5,
    });
  });
});

describe('html cost report by service test suite', () => {
  let nockCF: nock.Scope;
  let nockBilling: nock.Scope;

  beforeEach(() => {
    nock.cleanAll();

    nockCF = nock(ctx.app.cloudFoundryAPI);
    nockBilling = nock(config.billingAPI);
  });

  afterEach(() => {
    nockCF.done();
    nockBilling.done();

    nock.cleanAll();
  });

  const ctx: IContext = createTestContext();

  it('should show empty report for zero billables', async () => {
    // tslint:disable:max-line-length
    nockCF
    .get('/v3/organizations')
    .times(1)
    .reply(200, JSON.stringify(wrapV3Resources(defaultOrgv3())));

    const rangeStart = moment().startOf('month').format('YYYY-MM-DD');
    const period     = moment(rangeStart).format('MMMM YYYY');

    nockBilling
      .get('/billable_events')
      .query(true)
      .reply(200, '[]')
    ;

    nockCF
      .get('/v2/spaces')
      .query(true)
      .reply(200, '[]')
    ;

    const response = await reports.viewCostByServiceReport(ctx, {rangeStart});

    expect(response.body)
      .toContain(`Billables by service for ${period}`);

    expect(response.body)
      .toContain(`Billables by organisation and service for ${period}`);

    expect(spacesMissingAroundInlineElements(response.body as string)).toHaveLength(0);
  });

  it('should group billable events by org and service', async () => {
    const rangeStart = moment().startOf('month').format('YYYY-MM-DD');

    const defaultPriceDetails = {
      name: 'instance',
      start: '2018-04-20T14:36:09+00:00',
      stop: '2018-04-20T14:45:46+00:00',
      plan_name: 'default-plan-name',
      ex_vat: 0,
      inc_vat: 0,
      vat_rate: '0.2',
      vat_code: 'default-vat-code',
      currency_code: 'default-currency-code',
    };
    const defaultPrice = {
      ex_vat: 0,
      inc_vat: 0,
      details: [
        defaultPriceDetails,
      ],
    };
    const defaultBillableEvent = {
      event_guid: 'default-event-guid',
      event_start: '2018-04-20T14:36:09+00:00',
      event_stop: '2018-04-20T14:45:46+00:00',
      resource_guid: 'default-resource-guid',
      resource_name: 'default-resource-name',
      resource_type: 'app',
      org_guid: 'a7aff246-5f5b-4cf8-87d8-f316053e4a20',
      space_guid: 'default-space-guid',
      plan_guid: 'default-plan-guid',
      quota_definition_guid: 'default-quota-definition-guid',
      number_of_nodes: 1,
      memory_in_mb: 64,
      storage_in_mb: 0,
      price: defaultPrice,
    };

    // tslint:disable:max-line-length
    nockCF
    .get('/v3/organizations')
    .times(1)
    .reply(200, JSON.stringify(wrapV3Resources(defaultOrgv3())));

    nockBilling
      .get('/billable_events')
      .query(true)
      .times(1)
      .reply(200, JSON.stringify([
        {...defaultBillableEvent, price: {...defaultPrice, inc_vat: '1', details: [{...defaultPriceDetails, plan_name: 'task'}]}},
        {...defaultBillableEvent, price: {...defaultPrice, inc_vat: '10', details: [{...defaultPriceDetails, plan_name: 'staging'}]}},
        {...defaultBillableEvent, price: {...defaultPrice, inc_vat: '100', details: [{...defaultPriceDetails, plan_name: 'app'}]}},
        {...defaultBillableEvent, price: {...defaultPrice, inc_vat: '1000', details: [{...defaultPriceDetails, plan_name: 'postgres'}]}},
        {...defaultBillableEvent, price: {...defaultPrice, inc_vat: '10000', details: []}},
        {...defaultBillableEvent, org_guid: 'some-unknown-org', price: {...defaultPrice, inc_vat: '100000', details: []}},
      ]));
    nockCF
      .get('/v2/spaces')
      .reply(200, `{"total_results": 1, "total_pages": 1, "prev_url": null, "next_url": null, "resources": [{"metadata": {"guid": "default-space-guid"}, "entity": {"name": "default-space-name"}}]}`);

    const response = await reports.viewCostByServiceReport(ctx, {rangeStart});
    const reponseBody = (response.body || '').toString();
    expect(reponseBody).toMatch(/compute.+?(?=>£){3}.+?£111.00/);
    expect(reponseBody).toMatch(/postgres.+?(?=>£){3}.+?£1000.00/);
    expect(reponseBody).toMatch(/unknown<\/td><td class="govuk-table__cell govuk-table__cell--numeric">£10000.00/);
    expect(reponseBody).toMatch(/unknown<\/td><td class="govuk-table__cell govuk-table__cell--numeric">£100000.00/);

    expect(spacesMissingAroundInlineElements(response.body as string)).toHaveLength(0);
  });

});

describe('cost report grouping functions', () => {
  const defaultPriceDetails: IPriceComponent = {
    name: '',
    planName: '',
    start: new Date(),
    stop: new Date(),
    VATCode: '',
    VATRate: 0,
    currencyCode: '',
    exVAT: 0,
    incVAT: 0,
  };
  const defaultPrice = { incVAT: 0, exVAT: 0, details: [] };
  const defaultBillableEvent = {
    price: defaultPrice,
    eventGUID: '',
    eventStart: new Date(),
    eventStop: new Date(),
    resourceGUID: '',
    resourceName: '',
    resourceType: '',
    orgGUID: '',
    spaceGUID: '',
    spaceName: '',
    planGUID: '',
    numberOfNodes: 0,
    memoryInMB: 0,
    storageInMB: 0,
  };

  describe('getBillableEventsByService', () => {
    it('should work with zero events', () => {
      const result = reports.getBillableEventsByService([]);
      expect(result).toHaveLength(0);
    });

    it('should treat an event with no details as an unknown services', () => {
      const result = reports.getBillableEventsByService([{...defaultBillableEvent, price: {...defaultPrice, details: []}}]);
      expect(result).toHaveLength(1);
      expect(result[0].serviceGroup).toBe('unknown');
    });

    it('should sum costs for services of the same group', () => {
      const result = reports.getBillableEventsByService([
        {...defaultBillableEvent, price: {...defaultPrice, incVAT: 1, details: [{...defaultPriceDetails, planName: 'postgres tiny'}]}},
        {...defaultBillableEvent, price: {...defaultPrice, incVAT: 10, details: [{...defaultPriceDetails, planName: 'postgres medium'}]}},
        {...defaultBillableEvent, price: {...defaultPrice, incVAT: 100, details: [{...defaultPriceDetails, planName: 'postgres leviathan'}]}},
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].serviceGroup).toBe('postgres');
      expect(result[0].incVAT).toBe(111);
    });

    it('should sum costs for compute services', () => {
      const result = reports.getBillableEventsByService([
        {...defaultBillableEvent, price: {...defaultPrice, incVAT: 1, details: [{...defaultPriceDetails, planName: 'app'}]}},
        {...defaultBillableEvent, price: {...defaultPrice, incVAT: 10, details: [{...defaultPriceDetails, planName: 'staging'}]}},
        {...defaultBillableEvent, price: {...defaultPrice, incVAT: 100, details: [{...defaultPriceDetails, planName: 'task'}]}},
      ]);
      expect(result).toHaveLength(1);
      expect(result[0].serviceGroup).toBe('compute');
      expect(result[0].incVAT).toBe(111);
    });

    it('should group and sum costs for different services and sort by highest cost first', () => {
      const result = reports.getBillableEventsByService([
        {...defaultBillableEvent, price: {...defaultPrice, incVAT: 1, details: [{...defaultPriceDetails, planName: 'postgres tiny'}]}},
        {...defaultBillableEvent, price: {...defaultPrice, incVAT: 10, details: [{...defaultPriceDetails, planName: 'postgres medium'}]}},
        {...defaultBillableEvent, price: {...defaultPrice, incVAT: 100, details: [{...defaultPriceDetails, planName: 'postgres leviathan'}]}},
        {...defaultBillableEvent, price: {...defaultPrice, incVAT: 1000, details: [{...defaultPriceDetails, planName: 'app'}]}},
        {...defaultBillableEvent, price: {...defaultPrice, incVAT: 10000, details: [{...defaultPriceDetails, planName: 'staging'}]}},
        {...defaultBillableEvent, price: {...defaultPrice, incVAT: 100000, details: [{...defaultPriceDetails, planName: 'task'}]}},
      ]);
      expect(result).toHaveLength(2);
      expect(result[0].serviceGroup).toBe('compute');
      expect(result[0].incVAT).toBe(111000);
      expect(result[1].serviceGroup).toBe('postgres');
      expect(result[1].incVAT).toBe(111);
    });
  });

  describe('getBillableEventsByOrganisationAndService', () => {
    it('should work with zero events', () => {
      const result = reports.getBillableEventsByOrganisationAndService([], {});
      expect(result).toHaveLength(0);
    });

    it('should look up the organisation name by GUID', () => {
      const orgsByGUID = {'some-org-guid': [{name: 'some-org-name'} as any]};
      const result = reports.getBillableEventsByOrganisationAndService(
        [{...defaultBillableEvent, orgGUID: 'some-org-guid'}],
        orgsByGUID,
      );
      expect(result).toHaveLength(1);
      expect(result[0].orgName).toBe('some-org-name');
    });

    it('should group by organisation (sorted alphabetically), then by service (sorted by cost)', () => {
      const orgsByGUID = {
        'org-guid-one': [{name: 'org-name-one'} as any],
        'org-guid-two': [{name: 'org-name-two'} as any],
      };
      const result = reports.getBillableEventsByOrganisationAndService(
        [
          {...defaultBillableEvent, orgGUID: 'org-guid-two', price: {...defaultPrice, incVAT: 1, details: [{...defaultPriceDetails, planName: 'mysql'}]}},
          {...defaultBillableEvent, orgGUID: 'org-guid-two', price: {...defaultPrice, incVAT: 1, details: [{...defaultPriceDetails, planName: 'mysql'}]}},
          {...defaultBillableEvent, orgGUID: 'org-guid-one', price: {...defaultPrice, incVAT: 20, details: [{...defaultPriceDetails, planName: 'mysql'}]}},
          {...defaultBillableEvent, orgGUID: 'org-guid-one', price: {...defaultPrice, incVAT: 100, details: [{...defaultPriceDetails, planName: 'postgres'}]}},
        ],
        orgsByGUID,
      );
      expect(result).toHaveLength(3);
      expect(result[0].orgName).toBe('org-name-one');
      expect(result[0].serviceGroup).toBe('postgres');
      expect(result[0].incVAT).toBe(100);

      expect(result[1].orgName).toBe('org-name-one');
      expect(result[1].serviceGroup).toBe('mysql');
      expect(result[1].incVAT).toBe(20);

      expect(result[2].orgName).toBe('org-name-two');
      expect(result[2].serviceGroup).toBe('mysql');
      expect(result[2].incVAT).toBe(1 + 1);
    });
  });

  describe('getBillableEventsByOrganisationAndSpaceAndService', () => {
    it('should work with zero events', () => {
      const result = reports.getBillableEventsByOrganisationAndSpaceAndService([], {}, {});
      expect(result).toHaveLength(0);
    });

    it('should look up the organisation and space names by GUID', () => {
      const orgsByGUID = {'some-org-guid': [{name: 'some-org-name'} as any]};
      const spacesByGUID = {'some-space-guid': [{entity: {name: 'some-space-name'}} as any]};
      const result = reports.getBillableEventsByOrganisationAndSpaceAndService(
        [
          {...defaultBillableEvent, orgGUID: 'some-org-guid', spaceGUID: 'some-space-guid'},
          {...defaultBillableEvent, orgGUID: 'some-org-guid', spaceGUID: 'some-space-guid-that-doesnt-exist'},
        ],
        orgsByGUID,
        spacesByGUID,
      );
      expect(result).toHaveLength(2);
      expect(result[0].orgName).toBe('some-org-name');
      expect(result[0].spaceName).toBe('some-space-name');
      expect(result[1].orgName).toBe('some-org-name');
      expect(result[1].spaceName).toBe('unknown');
    });

    it('should group by organisation (sorted alphabetically), then by space (sorted alphabetically), then by service (sorted by cost)', () => {
      const orgsByGUID = {
        'org-guid-one': [{name: 'org-name-one'} as any],
        'org-guid-two': [{name: 'org-name-two'} as any],
      };
      const spacesByGUID = {
        'space-guid-one': [{entity: {name: 'space-name-one'}} as any],
        'space-guid-two': [{entity: {name: 'space-name-two'}} as any],
      };
      const result = reports.getBillableEventsByOrganisationAndSpaceAndService(
        [
          {...defaultBillableEvent, orgGUID: 'org-guid-two', spaceGUID: 'space-guid-one', price: {...defaultPrice, incVAT: 7, details: [{...defaultPriceDetails, planName: 'mysql'}]}},
          {...defaultBillableEvent, orgGUID: 'org-guid-two', spaceGUID: 'space-guid-one', price: {...defaultPrice, incVAT: 1, details: [{...defaultPriceDetails, planName: 'mysql'}]}},
          {...defaultBillableEvent, orgGUID: 'org-guid-two', spaceGUID: 'space-guid-two', price: {...defaultPrice, incVAT: 2, details: [{...defaultPriceDetails, planName: 'mysql'}]}},
          {...defaultBillableEvent, orgGUID: 'org-guid-one', spaceGUID: 'space-guid-one', price: {...defaultPrice, incVAT: 20, details: [{...defaultPriceDetails, planName: 'mysql'}]}},
          {...defaultBillableEvent, orgGUID: 'org-guid-one', spaceGUID: 'space-guid-two', price: {...defaultPrice, incVAT: 100, details: [{...defaultPriceDetails, planName: 'postgres'}]}},
        ],
        orgsByGUID,
        spacesByGUID,
      );
      expect(result).toHaveLength(4);

      expect(result[0].orgName).toBe('org-name-one');
      expect(result[0].spaceName).toBe('space-name-one');
      expect(result[0].serviceGroup).toBe('mysql');
      expect(result[0].incVAT).toBe(20);

      expect(result[1].orgName).toBe('org-name-one');
      expect(result[1].spaceName).toBe('space-name-two');
      expect(result[1].serviceGroup).toBe('postgres');
      expect(result[1].incVAT).toBe(100);

      expect(result[2].orgName).toBe('org-name-two');
      expect(result[2].spaceName).toBe('space-name-one');
      expect(result[2].serviceGroup).toBe('mysql');
      expect(result[2].incVAT).toBe(7 + 1);

      expect(result[3].orgName).toBe('org-name-two');
      expect(result[3].spaceName).toBe('space-name-two');
      expect(result[3].serviceGroup).toBe('mysql');
      expect(result[3].incVAT).toBe(2);
    });
  });
});

describe('csv organisation monthly spend report for the pmo team', () => {
  const ctx: IContext = createTestContext();
  let nockCF: nock.Scope;

  beforeEach(() => {
    nock.cleanAll();
    nockCF = nock(ctx.app.cloudFoundryAPI);
    nockCF
      .get(`/v2/quota_definitions?q=name:default`)
      .reply(200, `{"resources": [
        {"metadata": {"guid": "default-quota"}, "entity": {"name": "default"}}
      ]}`);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('should return a one-line CSV when there are no organisations', async () => {
    const rangeStart = moment().startOf('month').format('YYYY-MM-DD');

    nockCF.get('/v3/organizations')
      .times(5)
      .reply(200, JSON.stringify(wrapV3Resources()));
    nock(config.billingAPI)
      .get('/billable_events')
      .query(true)
      .reply(200, '[]');

    const response = await reports.viewPmoOrgSpendReportCSV(ctx, {rangeStart});
    expect(response.download).not.toBeUndefined();
    expect(response.download!.data)
      .toEqual(`Billing month,Org,Region,Unique ID,Spend in GBP without VAT`);
  });

  it('should name the CSV appropriately', async () => {
    nockCF.get('/v3/organizations')
      .times(5)
      .reply(200, JSON.stringify(wrapV3Resources(defaultOrgv3())));
    nock(config.billingAPI)
      .get('/billable_events')
      .query(true)
      .reply(200, '[]');

    const response = await reports.viewPmoOrgSpendReportCSV(ctx, {rangeStart: '2018-01-01'});
    expect(response.download).not.toBeUndefined();
    expect(response.download!.name)
      .toEqual('paas-pmo-org-spend-ireland-2018-01.csv');
  });

  it('should apply the 10% admin fee', async () => {
    const rangeStart = moment().startOf('month');

    const defaultPriceDetails = {
      name: 'instance',
      start: '2018-04-20T14:36:09+00:00',
      stop: '2018-04-20T14:45:46+00:00',
      plan_name: 'default-plan-name',
      ex_vat: 0,
      inc_vat: 0,
      vat_rate: 10,
    };
    const defaultPrice = {
      ex_vat: 0,
      inc_vat: 0,
      details: [defaultPriceDetails],
    };
    const defaultBillableEvent = {
      event_guid: 'default-event-guid',
      event_start: '2018-04-20T14:36:09+00:00',
      event_stop: '2018-04-20T14:45:46+00:00',
      resource_guid: 'default-resource-guid',
      resource_name: 'default-resource-name',
      resource_type: 'app',
      org_guid: 'a7aff246-5f5b-4cf8-87d8-f316053e4a20',
      space_guid: 'default-space-guid',
      plan_guid: 'default-plan-guid',
      quota_definition_guid: 'default-quota-definition-guid',
      number_of_nodes: 1,
      memory_in_mb: 64,
      storage_in_mb: 0,
      price: defaultPrice,
    };
    nock(config.billingAPI)
      .get('/billable_events')
      .query(true)
      .times(2)
      .reply(200, JSON.stringify([
        {...defaultBillableEvent, org_guid: 'org-one', price: {...defaultPrice, ex_vat: '1'}},
      ]));
    nockCF
      .get('/v3/organizations')
      .reply(200, wrapV3Resources(
        {...defaultOrgv3(), guid: 'org-one', name: 'Org One'},
      ));

    const response = await reports.viewPmoOrgSpendReportCSV(ctx, {rangeStart: rangeStart.format('YYYY-MM-DD')});
    expect(response.download).not.toBeUndefined();
    const records = parse(response.download!.data, {columns: true});
    expect(records.length).toEqual(1);
    expect(records).toContainEqual({
      'Billing month': rangeStart.format('MMMM YYYY'),
      'Org': 'Org One',
      'Region': 'Ireland',
      'Unique ID': 'org-one',
      'Spend in GBP without VAT': '1.10',
    });
  });

  it('should group billable events by org', async () => {
    const rangeStart = moment().startOf('month');

    const defaultPriceDetails = {
      name: 'instance',
      start: '2018-04-20T14:36:09+00:00',
      stop: '2018-04-20T14:45:46+00:00',
      plan_name: 'default-plan-name',
      ex_vat: 0,
      inc_vat: 0,
      vat_rate: 10,
    };
    const defaultPrice = {
      ex_vat: 0,
      inc_vat: 0,
      details: [defaultPriceDetails],
    };
    const defaultBillableEvent = {
      event_guid: 'default-event-guid',
      event_start: '2018-04-20T14:36:09+00:00',
      event_stop: '2018-04-20T14:45:46+00:00',
      resource_guid: 'default-resource-guid',
      resource_name: 'default-resource-name',
      resource_type: 'app',
      org_guid: 'a7aff246-5f5b-4cf8-87d8-f316053e4a20',
      space_guid: 'default-space-guid',
      plan_guid: 'default-plan-guid',
      quota_definition_guid: 'default-quota-definition-guid',
      number_of_nodes: 1,
      memory_in_mb: 64,
      storage_in_mb: 0,
      price: defaultPrice,
    };
    nock(config.billingAPI)
      .get('/billable_events')
      .query(true)
      .times(2)
      .reply(200, JSON.stringify([
        {...defaultBillableEvent, org_guid: 'org-one', price: {...defaultPrice, ex_vat: '1'}},
        {...defaultBillableEvent, org_guid: 'org-two', price: {...defaultPrice, ex_vat: '10'}},
        {...defaultBillableEvent, org_guid: 'org-one', price: {...defaultPrice, ex_vat: '100'}},
        {...defaultBillableEvent, org_guid: 'org-one', price: {...defaultPrice, ex_vat: '1000'}},
        {...defaultBillableEvent, org_guid: 'org-two', price: {...defaultPrice, ex_vat: '10000'}},
      ]));
    nockCF
      .get('/v3/organizations')
      .reply(200, wrapV3Resources(
        {...defaultOrgv3(), guid: 'org-one', name: 'Org One'},
        {...defaultOrgv3(), guid: 'org-two', name: 'Org Two'},
      ));

    const response = await reports.viewPmoOrgSpendReportCSV(ctx, {rangeStart: rangeStart.format('YYYY-MM-DD')});
    expect(response.download).not.toBeUndefined();
    const records = parse(response.download!.data, {columns: true});
    expect(records.length).toEqual(2);
    expect(records).toContainEqual({
      'Billing month': rangeStart.format('MMMM YYYY'),
      'Org': 'Org One',
      'Region': 'Ireland',
      'Unique ID': 'org-one',
      'Spend in GBP without VAT': '1211.10',
    });
    expect(records).toContainEqual({
      'Billing month': rangeStart.format('MMMM YYYY'),
      'Org': 'Org Two',
      'Region': 'Ireland',
      'Unique ID': 'org-two',
      'Spend in GBP without VAT': '11011.00',
    });
  });

  it('should list billable orgs which have no billable events', async () => {
    const rangeStart = moment().startOf('month');

    nockCF.get('/v3/organizations')
      .times(5)
      .reply(200, JSON.stringify(wrapV3Resources(
        {...defaultOrgv3(), guid: 'org-with-nothing-billed', name: 'Org With Nothing Billed'},
       )));
    nock(config.billingAPI)
      .get('/billable_events')
      .query(true)
      .reply(200, '[]');

    const response = await reports.viewPmoOrgSpendReportCSV(ctx, {
      rangeStart: rangeStart.format('YYYY-MM-DD'),
    });
    expect(response.download).not.toBeUndefined();
    const records = parse(response.download!.data, {columns: true});
    expect(records.length).toEqual(1);
    expect(records[0]).toEqual({
      'Billing month': rangeStart.format('MMMM YYYY'),
      'Org': 'Org With Nothing Billed',
      'Region': 'Ireland',
      'Unique ID': 'org-with-nothing-billed',
      'Spend in GBP without VAT': '0.00',
    });
  });
});

describe('cost report grouping functions', () => {
  const defaultPrice = { incVAT: 0, exVAT: 0, details: [] };
  const defaultBillableEvent = {
    price: defaultPrice,
    eventGUID: '',
    eventStart: new Date(),
    eventStop: new Date(),
    resourceGUID: '',
    resourceName: '',
    resourceType: '',
    orgGUID: '',
    spaceGUID: '',
    spaceName: '',
    planGUID: '',
    numberOfNodes: 0,
    memoryInMB: 0,
    storageInMB: 0,
  };

  describe('getBillablesByOrganisation', () => {
    it('should work with zero orgs and events', () => {
      const results = reports.getBillablesByOrganisation([], []);
      expect(results).toHaveLength(0);
    });

    it('should work with zero events', () => {
      const results = reports.getBillablesByOrganisation([defaultOrgv3()], []);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        org:   defaultOrgv3(),
        exVAT: 0,
      });
    });

    it('should sum costs for services of the same organisation', () => {
      const results = reports.getBillablesByOrganisation([
        {...defaultOrgv3(), guid: 'org-one', name: 'Org One'},
      ], [
        {...defaultBillableEvent, orgGUID: 'org-one', price: {...defaultPrice, exVAT: 1}},
        {...defaultBillableEvent, orgGUID: 'org-one', price: {...defaultPrice, exVAT: 10}},
      ]);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        org:   {...defaultOrgv3(), guid: 'org-one', name: 'Org One'},
        exVAT: 11,
      });
    });

    it('should not sum costs for different organisations', () => {
      const results = reports.getBillablesByOrganisation([
        {...defaultOrgv3(), guid: 'org-one', name: 'Org One'},
        {...defaultOrgv3(), guid: 'org-two', name: 'Org Two'},
      ], [
        {...defaultBillableEvent, orgGUID: 'org-one', price: {...defaultPrice, exVAT: 5}},
        {...defaultBillableEvent, orgGUID: 'org-two', price: {...defaultPrice, exVAT: 7}},
      ]);
      expect(results).toHaveLength(2);
      expect(results).toContainEqual({
        org:   {...defaultOrgv3(), guid: 'org-one', name: 'Org One'},
        exVAT: 5,
      });
      expect(results).toContainEqual({
        org:   {...defaultOrgv3(), guid: 'org-two', name: 'Org Two'},
        exVAT: 7,
      });
    });
  });

  it('filterRealOrgs should filter out tests and admin', () => {
    const orgs = [
      {...defaultOrgv3(), name: 'govuk-doggos' },
      {...defaultOrgv3(), name: 'admin' },
      {...defaultOrgv3(), name: 'ACC-123' },
      {...defaultOrgv3(), name: 'BACC-123' },
      {...defaultOrgv3(), name: 'CATS-123' },
      {...defaultOrgv3(), name: 'department-for-coffee' },
      {...defaultOrgv3(), name: 'SMOKE-' },
    ];

    const filteredOrgs = reports.filterRealOrgs(orgs);

    expect(filteredOrgs.length).toEqual(2);
    expect(filteredOrgs[0].name).toEqual('govuk-doggos');
    expect(filteredOrgs[1].name).toEqual('department-for-coffee');
  });

  it('filterBillableOrgs should filter out trial orgs', () => {
    const trialGUID = 'trial-guid';
    const paidGUID = 'expensive-guid';

    const orgs = [
      {
        ...defaultOrgv3(),
        relationships: {quota: {data: { guid: trialGUID }}},
        name:          '1-trial-org',
      },
      {
        ...defaultOrgv3(),
        relationships: {quota: {data: { guid: paidGUID }}},
        name:          '1-paid-org',
      },
      {
        ...defaultOrgv3(),
        relationships: {quota: {data: { guid: trialGUID }}},
        name:          '2-trial-org',
      },
      {
        ...defaultOrgv3(),
        relationships: {quota: {data: { guid: paidGUID }}},
        name:          '2-paid-org',
      },
    ];

    const billableOrgs = reports.filterBillableOrgs(trialGUID, orgs);

    expect(billableOrgs.length).toEqual(2);
    expect(billableOrgs).toContainEqual(orgs[1]);
    expect(billableOrgs).toContainEqual(orgs[3]);
  });
});

describe('html visualisation report test suite', () => {
  let nockCF: nock.Scope;
  let nockBilling: nock.Scope;
  const ctx: IContext = createTestContext();

  beforeEach(() => {
    nock.cleanAll();

    nockCF = nock(ctx.app.cloudFoundryAPI);
    nockBilling = nock(config.billingAPI);
  });

  afterEach(() => {
    nockCF.done();
    nockBilling.done();

    nock.cleanAll();
  });

  it('should show empty report for zero billables', async () => {
    const rangeStart = moment().startOf('month').format('YYYY-MM-DD');

    nockCF
    .get('/v3/organizations')
    .times(1)
    .reply(200, JSON.stringify(wrapV3Resources(defaultOrgv3())))
  ;

    nockBilling
      .get('/billable_events')
      .query(true)
      .reply(200, '[]')
    ;

    const response = await reports.viewVisualisation(ctx, {rangeStart});

    expect(response.body).toContain(`No data`);
    expect(response.body).not.toContain(`<svg id="sankey"`);

    expect(spacesMissingAroundInlineElements(response.body as string)).toHaveLength(0);
  });

  it('should show non empty report for non-zero billables', async () => {
    const rangeStart = moment().startOf('month').format('YYYY-MM-DD');

    nockCF
    .get('/v3/organizations')
    .times(1)
    .reply(200, JSON.stringify(wrapV3Resources(defaultOrgv3())))
  ;

    nockBilling
      .get('/billable_events')
      .query(true)
      .reply(200, `[{
        "event_guid":"default-event-guid",
        "event_start":"2018-04-20T14:36:09+00:00",
        "event_stop":"2018-04-20T14:45:46+00:00",
        "resource_guid":"default-resource-guid",
        "resource_name":"default-resource-name",
        "resource_type":"app",
        "org_guid":"a7aff246-5f5b-4cf8-87d8-f316053e4a20",
        "space_guid":"default-space-guid",
        "plan_guid":"default-plan-guid",
        "quota_definition_guid":"default-quota-definition-guid",
        "number_of_nodes":1,
        "memory_in_mb":64,
        "storage_in_mb":0,
        "price":{"ex_vat":0,"inc_vat":0,"details":[{
          "name":"instance",
          "start":"2018-04-20T14:36:09+00:00",
          "stop":"2018-04-20T14:45:46+00:00",
          "plan_name":"default-plan-name",
          "ex_vat":0,
          "inc_vat":0,
          "vat_rate":"0.2",
          "vat_code":"default-vat-code",
          "currency_code":"default-currency-code"
        }]}
      }]`);

    const response = await reports.viewVisualisation(ctx, {rangeStart});

    expect(response.body).toContain(`<svg id="sankey"`);
    expect(response.body).not.toContain(`No data`);

    expect(spacesMissingAroundInlineElements(response.body as string)).toHaveLength(0);
  });
});

describe('building D3 sankey input', () => {
  it('should produce empty output with empty input', () => {
    const result = reports.buildD3SankeyInput([], []);
    expect(result.nodes).toHaveLength(0);
    expect(result.links).toHaveLength(0);
  });

  it('should produce nodes and links from billables, ignoring orgs without billables', () => {
    const defaultBillable = {
      orgName: 'default-org-name',
      orgGUID: 'default-org-guid',
      serviceGroup: 'default-service',
      exVAT: 0,
      incVAT: 0,
    };

    const result = reports.buildD3SankeyInput([
      {...defaultBillable, orgName: 'org-1', serviceGroup: 'service-1', exVAT: 1},
      {...defaultBillable, orgName: 'org-2', serviceGroup: 'service-1', exVAT: 2},
      {...defaultBillable, orgName: 'org-2', serviceGroup: 'service-2', exVAT: 3},
    ], [
      {org: 'org-1', owner: 'owner-1'},
      {org: 'org-2', owner: 'owner-1'},
      {org: 'org-without-billables', owner: 'owner-2'},
    ]);
    expect(result.nodes).toEqual([
      {name: 'service-1'},
      {name: 'service-2'},
      {name: 'org-1'},
      {name: 'org-2'},
      {name: 'owner-1'},
    ]);
    expect(result.links).toEqual([
      {source: 0, target: 2, value: 1},
      {source: 0, target: 3, value: 2},
      {source: 1, target: 3, value: 3},
      {source: 2, target: 4, value: 1},
      {source: 3, target: 4, value: 5},
    ]);
  });
});