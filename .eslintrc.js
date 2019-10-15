module.exports = {
  parserOptions: {
    ecmaVersion: 9,
    sourceType: 'module'
  },
  env: {
    node: true,
    es6: true
  },
  extends: ['@hellomouse/typescript'],
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off'
  }
};
