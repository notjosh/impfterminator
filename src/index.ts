import { format, isWithinInterval, sub } from 'date-fns';
import fs from 'fs';
import { flatten } from 'lodash';
import groupBy from 'lodash/groupBy';
import Path from 'path';
import * as Maths from './Maths';
import { notEmpty } from './notEmpty';
import {
  ChartSource,
  ChartSourceDay,
  Vaccination,
  VaccinationLocation,
  VaccinationType,
} from './synced-types/impfterminspection/types';
import { Response } from './synced-types/impfterminspector/api/types';
import { InsuranceType } from './synced-types/impfterminspector/doctolib/insurance-types';
import { BookingSource } from './synced-types/impfterminspector/doctolib/types';
import { VaccinationType as VACCINATION_TYPE } from './synced-types/impfterminspector/doctolib/vaccination-types';
import daysUntil from './synced-types/impfterminspector/util/daysUntil';

const ONLY_PUBLIC = true;

type InJsonResult = {
  sampledAt: Date;
  source: {
    bookingSource: BookingSource;
    url: string;
  };
  response?: {
    next: string | null;
    data: Response;
  };
  error?: Record<string, unknown>;
};

type InJson = {
  date: string;
  results: InJsonResult[];
};

const yyyymmdd = (date: Date): string => {
  return format(date, 'yyyy-MM-dd');
};

const practiceId2location = (id: string): VaccinationLocation => {
  switch (id) {
    case '158431':
      return VaccinationLocation.Arena;
    case '158434':
      return VaccinationLocation.Messe;
    case '158436':
      return VaccinationLocation.Tegel;
    case '158433':
      return VaccinationLocation.Tempelhof;
    case '158435':
      return VaccinationLocation.Velodrom;
    case '158437':
      return VaccinationLocation.Eisstadion;
  }

  throw new Error(`unknown practice ID: ${id}`);
};

const vaccinationType2vaccinationType = (
  type: VACCINATION_TYPE
): VaccinationType => {
  switch (type) {
    case VACCINATION_TYPE.ASTRAZENECA:
      return VaccinationType.Astrazeneca;
    case VACCINATION_TYPE.BIONTECH_PFIZER:
      return VaccinationType.BiontechPfizer;
    case VACCINATION_TYPE.MODERNA:
      return VaccinationType.Moderna;
  }
};

const calculateForRecords = (
  results: InJsonResult[],
  fromDate: Date
): Vaccination[] => {
  const vaccinations = results
    .map((result): Vaccination | null => {
      if (result.response == null) {
        return null;
      }

      // sometimes result.response.next has a date, but no slots are available. let's check the response for slots.
      let next: string | null = result.response.next;

      if (next != null) {
        const { availabilities } = result.response.data;
        const withSlots = availabilities.filter(
          (availability) => availability.slots.length > 0
        );

        if (withSlots.length > 0) {
          const slotNext = withSlots[0].date;
          if (slotNext != null) {
            next = slotNext;
          }
        }
      }

      return {
        days: next != null ? daysUntil(next, fromDate) : null,
        type: vaccinationType2vaccinationType(
          result.source.bookingSource.vaccination
        ),
        location: practiceId2location(
          result.source.bookingSource.site.doctolib.practiceId
        ),
        insurance: result.source.bookingSource.insurance,
      };
    })
    .filter(notEmpty);

  const groupedVaccinations = groupBy(vaccinations, (vaccination) => {
    return [vaccination.type, vaccination.location, vaccination.insurance];
  });

  const averaged = Object.values(groupedVaccinations).map((group) => {
    const vaccinationsWithDays = group.filter(
      (vaccination) => vaccination.days != null
    );

    const average = Maths.median(
      vaccinationsWithDays.map((v) => v.days).filter(notEmpty)
    );

    return {
      ...group[0],
      days: vaccinationsWithDays.length > 0 ? average : null,
    };
  });

  return averaged;
};

const calculate = (keys: string[], grouped: Record<string, InJsonResult[]>) => {
  return keys.map((key) => {
    const results = grouped[key];

    const averaged = calculateForRecords(results, new Date(key));

    return {
      date: key,
      vaccinations: averaged,
    };
  });
};

const run = () => {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    console.error('requires 2 args');
    console.error(
      'usage: bin/run.sh /path/to/manyjsons /path/to/chartData.json'
    );
    process.exit(1);
  }

  const inDir = args[0];
  const outPath = args[1];

  const inJson: InJson[] = fs
    .readdirSync(inDir)
    .filter((s) => s.endsWith('.json'))
    .map((s) => Path.join(inDir, s))
    .map((path) => fs.readFileSync(path, 'utf8'))
    .map((blob) => JSON.parse(blob));

  const grouped = inJson.reduce((acc, value) => {
    const { date } = value;
    let { results } = value;

    const dateObject = new Date(date);
    const dateString = yyyymmdd(dateObject);

    const existing = acc[dateString] ?? [];

    if (ONLY_PUBLIC) {
      results = results.filter(
        (result) =>
          result.source.bookingSource.insurance === InsuranceType.PUBLIC
      );
    }

    return {
      ...acc,
      [dateString]: [
        ...existing,
        ...results.map((result) => ({ ...result, sampledAt: dateObject })),
      ],
    };
  }, {} as Record<string, InJsonResult[]>);

  const now = new Date();
  const anHourAgo = sub(now, { hours: 1 });
  const recent = flatten(Object.values(grouped)).filter((record) =>
    isWithinInterval(record.sampledAt, { start: anHourAgo, end: now })
  );

  // console.log(recent);
  // console.log(grouped[]);

  const output: ChartSource = {
    updatedAt: new Date().toISOString(),
    current: calculateForRecords(recent, now),
    overall: calculate(Object.keys(grouped), grouped),
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
};

export { run };
