import { expect, test } from 'bun:test';
import {
  buildMetadataReadinessSummary,
  formatExifAperture,
  formatExifApertureFromMetadata,
  formatExifFocalLength,
  formatExifFocalLengthFromMetadata,
  type MetadataExifData,
  parseExifMetadataNumber,
} from '../../../src/utils/metadataPanelContracts.ts';

test('normalizes aperture display across decimal, prefixed, and rational RAW EXIF values', () => {
  expect(formatExifAperture('2.8')).toBe('f/2.8');
  expect(formatExifAperture('f/2.8')).toBe('f/2.8');
  expect(formatExifAperture('28/10')).toBe('f/2.8');
  expect(formatExifAperture('56/10')).toBe('f/5.6');
});

test('normalizes focal length display across decimal, unit, and rational RAW EXIF values', () => {
  expect(formatExifFocalLength('35')).toBe('35 mm');
  expect(formatExifFocalLength('35 mm')).toBe('35 mm');
  expect(formatExifFocalLength('1050/10')).toBe('105 mm');
});

test('prefers actual focal length and falls back to 35mm equivalent metadata', () => {
  expect(formatExifFocalLengthFromMetadata({ FocalLength: '240/10', FocalLengthIn35mmFilm: '35' })).toBe('24 mm');
  expect(formatExifFocalLengthFromMetadata({ FocalLengthIn35mmFilm: '35' })).toBe('35 mm');
  expect(formatExifFocalLengthFromMetadata({ FocalLength: '0', FocalLengthIn35mmFilm: '35' })).toBe('35 mm');
});

test('distinguishes missing, invalid, zero, and valid camera metadata parses', () => {
  expect(parseExifMetadataNumber(undefined)).toMatchObject({ status: 'missing', value: null });
  expect(parseExifMetadataNumber('unknown mm')).toMatchObject({ status: 'invalid', value: null });
  expect(parseExifMetadataNumber('0')).toMatchObject({ status: 'zero', value: 0 });
  expect(parseExifMetadataNumber('8/1')).toMatchObject({ status: 'valid', value: 8 });
});

test('does not display zero or lens id placeholders as camera metadata', () => {
  expect(formatExifAperture('0')).toBeUndefined();
  expect(formatExifFocalLength('0')).toBeUndefined();
  expect(formatExifAperture('f/0')).toBeUndefined();
  expect(formatExifFocalLength('0:0')).toBeUndefined();
  expect(formatExifAperture('unknown')).toBeUndefined();
  expect(formatExifFocalLength('unknown mm')).toBeUndefined();
  expect(formatExifApertureFromMetadata({ FNumber: 'f/0', ApertureValue: '8' })).toBe('f/8');
});

test('metadata readiness counts normalized camera values instead of bad raw placeholders', () => {
  const exif: MetadataExifData = {
    ExposureTime: '1/125',
    FNumber: 'unknown',
    FocalLength: '0',
    PhotographicSensitivity: '100',
  };

  expect(formatExifApertureFromMetadata(exif)).toBeUndefined();
  expect(formatExifFocalLengthFromMetadata(exif)).toBeUndefined();
  expect(
    buildMetadataReadinessSummary({
      exif,
      gpsCoordinates: null,
      selectionCount: 1,
    }).cameraFieldCount,
  ).toBe(2);
});
