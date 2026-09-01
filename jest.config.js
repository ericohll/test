module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/frontend/', '/.aws-sam/'],
  collectCoverageFrom: ['src/**/*.js', '!src/handlers/**'],
};
