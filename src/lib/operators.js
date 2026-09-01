const OPERATORS = ['lt', 'lte', 'gt', 'gte', 'eq'];

function passes(value, operator, threshold) {
  const v = Number(value);
  const t = Number(threshold);
  switch (operator) {
    case 'lt':
      return v < t;
    case 'lte':
      return v <= t;
    case 'gt':
      return v > t;
    case 'gte':
      return v >= t;
    case 'eq':
      return v === t;
    default:
      throw new Error(`Unknown operator: ${operator}`);
  }
}

module.exports = { OPERATORS, passes };
