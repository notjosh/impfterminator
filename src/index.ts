import fs from 'fs';
import Path from 'path';
import { Vaccination } from './synced-types/impfterminspection/types';
import { Response } from './synced-types/impfterminspector/api/types';
import { BookingSource } from './synced-types/impfterminspector/doctolib/types';
import daysUntil from './synced-types/impfterminspector/util/daysUntil';
import groupBy from 'lodash/groupBy';
import meanBy from 'lodash/meanBy';

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

  type InJsonResult = {
    source: {
      bookingSource: BookingSource;
      url: string;
    };
    response: {
      next: string | null;
      data: Response;
    };
  };

  type InJson = {
    date: string;
    results: InJsonResult[];
  };

  const inJson: InJson[] = fs
    .readdirSync(inDir)
    .filter((s) => s.endsWith('.json'))
    .map((s) => Path.join(inDir, s))
    .map((path) => fs.readFileSync(path, 'utf8'))
    .map((blob) => JSON.parse(blob));

  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Berlin',
  });

  const yyyymmdd = (date: Date): string => {
    const parts = formatter.formatToParts(date);

    const find = (key: string): string =>
      parts.find((part) => part.type === key)!.value;

    return `${find('year')}-${find('month')}-${find('day')}`;
  };

  const practiveId2location = (
    id: string
  ): 'arena' | 'messe' | 'tegel' | 'tempelhof' | 'velodrom' => {
    switch (id) {
      case '158431':
        return 'arena';
      case '158434':
        return 'messe';
      case '158436':
        return 'tegel';
      case '158433':
        return 'tempelhof';
      case '158435':
        return 'velodrom';
    }

    throw new Error(`unknown practice ID: ${id}`);
  };

  const grouped = inJson.reduce((acc, value) => {
    const { date, results } = value;

    const dateString = yyyymmdd(new Date(date));

    const existing = acc[dateString] ?? [];

    return {
      ...acc,
      [dateString]: [...existing, ...results],
    };
  }, {} as Record<string, InJsonResult[]>);

  const keys = Object.keys(grouped);

  const output = keys.map((key) => {
    const results = grouped[key];

    const vaccinations = results.map(
      (result): Vaccination => {
        return {
          days:
            result.response.next != null
              ? daysUntil(result.response.next, new Date(key))
              : null,
          type: result.source.bookingSource.vaccination,
          location: practiveId2location(
            result.source.bookingSource.site.doctolib.practiceId
          ),
          insurance: result.source.bookingSource.insurance,
        };
      }
    );

    const groupedVaccinations = groupBy(vaccinations, (vaccination) => {
      return [vaccination.type, vaccination.location, vaccination.insurance];
    });

    const meaned = Object.values(groupedVaccinations).map((group) => {
      const vaccinationsWithDays = group.filter(
        (vaccination) => vaccination.days != null
      );
      const mean = meanBy(vaccinationsWithDays, 'days');

      return {
        ...group[0],
        days: vaccinationsWithDays.length > 0 ? mean : null,
      };
    });

    return {
      date: key,
      vaccinations: meaned,
    };
  });

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
};

export { run };
