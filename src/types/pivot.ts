/**
 * Pivot Table Builder Types
 *
 * Interfaces and constants for the pivot table configuration and query building.
 */

import type { TypeCategory } from '../utils/typeUtils'
import type { DatabaseEngine } from './database'

/** Granularity for date/datetime field grouping */
export type DateGranularity = 'year' | 'quarter' | 'month' | 'week' | 'date'

/** A field selected for row grouping or column cross-tabulation */
export interface PivotField {
  name: string
  type: string              // Raw column type from database
  typeCategory: TypeCategory
  dateGranularity?: DateGranularity  // Only for date/datetime fields
}

/** Supported metric aggregations */
export type MetricAggregation = 'count' | 'sum' | 'avg' | 'proportion'

/** A metric to compute in the pivot table */
export interface PivotMetric {
  field: string             // Column name to aggregate, or '*' for count
  aggregation: MetricAggregation
}

/**
 * Filter operators vary by type category:
 *   number:  =, !=, >, <, >=, <=, is_null, is_not_null
 *   text:    =, !=, contains, starts_with, is_null, is_not_null
 *   date:    =, !=, before, after, between, is_null, is_not_null
 *   boolean: =, is_null, is_not_null
 */
export type FilterOperator =
  | '=' | '!='
  | '>' | '<' | '>=' | '<='
  | 'contains' | 'starts_with'
  | 'before' | 'after' | 'between'
  | 'is_null' | 'is_not_null'

/** A single filter condition */
export interface PivotFilter {
  field: string
  operator: FilterOperator
  value: string             // For 'between': "val1,val2"
  typeCategory: TypeCategory
}

/** Column metadata available for field selection */
export interface AvailableColumn {
  name: string
  type: string
  typeCategory: TypeCategory
}

/** Full pivot configuration (persisted as JSON in box.query) */
export interface PivotConfig {
  version: 2
  tableName: string
  rowFields: PivotField[]
  columnField: PivotField | null
  metrics: PivotMetric[]
  filters: PivotFilter[]
  heatmapEnabled?: boolean
  sourceEngine?: DatabaseEngine
  originalQuery?: string
  connectionId?: string
  availableColumns?: AvailableColumn[]
}

/** Operators available per type category */
export const OPERATORS_BY_TYPE: Partial<Record<TypeCategory, { value: FilterOperator; label: string }[]>> = {
  number: [
    { value: '=', label: 'equals' },
    { value: '!=', label: 'not equals' },
    { value: '>', label: 'greater than' },
    { value: '<', label: 'less than' },
    { value: '>=', label: 'greater or equal' },
    { value: '<=', label: 'less or equal' },
    { value: 'is_null', label: 'is null' },
    { value: 'is_not_null', label: 'is not null' },
  ],
  text: [
    { value: '=', label: 'equals' },
    { value: '!=', label: 'not equals' },
    { value: 'contains', label: 'contains' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'is_null', label: 'is null' },
    { value: 'is_not_null', label: 'is not null' },
  ],
  date: [
    { value: '=', label: 'equals' },
    { value: '!=', label: 'not equals' },
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'between', label: 'between' },
    { value: 'is_null', label: 'is null' },
    { value: 'is_not_null', label: 'is not null' },
  ],
  boolean: [
    { value: '=', label: 'equals' },
    { value: 'is_null', label: 'is null' },
    { value: 'is_not_null', label: 'is not null' },
  ],
}

/** Available metrics per type category */
export const METRICS_BY_TYPE: Partial<Record<TypeCategory, { value: MetricAggregation; label: string }[]>> = {
  number: [
    { value: 'sum', label: 'Sum' },
    { value: 'avg', label: 'Average' },
    { value: 'count', label: 'Count' },
    { value: 'proportion', label: 'Proportion %' },
  ],
  text: [
    { value: 'count', label: 'Count' },
    { value: 'proportion', label: 'Proportion %' },
  ],
  date: [
    { value: 'count', label: 'Count' },
    { value: 'proportion', label: 'Proportion %' },
  ],
  boolean: [
    { value: 'count', label: 'Count' },
    { value: 'proportion', label: 'Proportion %' },
  ],
}

/** Date granularity options */
export const DATE_GRANULARITIES: { value: DateGranularity; label: string }[] = [
  { value: 'year', label: 'Year' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'date', label: 'Date' },
]
