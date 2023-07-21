/* eslint-disable prettier/prettier */
// eslint-disable-next-line no-undef
module.exports = {
    extends: [
        'eslint:recommended', 
        'plugin:@typescript-eslint/recommended',
        "plugin:prettier/recommended"
    ],
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint', 'prettier'],
    root: true,
  };