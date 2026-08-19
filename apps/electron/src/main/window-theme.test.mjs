import assert from 'node:assert/strict'
import test from 'node:test'
import { getInitialMainWindowThemeSource } from './window-theme.ts'

void test('forces onboarding window chrome light until the product takes over', () => {
  assert.equal(getInitialMainWindowThemeSource('/onboarding'), 'light')
  assert.equal(getInitialMainWindowThemeSource('/'), 'system')
  assert.equal(getInitialMainWindowThemeSource(), 'system')
})
