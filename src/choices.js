'use strict';

/** 1 = hemmavinst, X = oavgjort, 2 = bortavinst. */
const CHOICES = ['1', 'X', '2'];

/** The tally columns on the polls row, in the same order as CHOICES. */
const COUNT_COLUMNS = { 1: 'count_1', X: 'count_x', 2: 'count_2' };

module.exports = { CHOICES, COUNT_COLUMNS };
