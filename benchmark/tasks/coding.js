export const codingTasks = [
  {
    id: 'fizzbuzz',
    prompt:
      'Write a JavaScript function called fizzbuzz(n) that returns an array of n strings. ' +
      'For multiples of 3 use "Fizz", multiples of 5 use "Buzz", multiples of both use "FizzBuzz", otherwise the number as a string. ' +
      'Start from 1. Return only the function definition.',
    check(response) {
      return (
        /fizzbuzz/i.test(response) &&
        /FizzBuzz/i.test(response) &&
        (/for\s*\(/.test(response) || /while\s*\(/.test(response) || /\.map\b/.test(response)) &&
        (/%\s*15/.test(response) || (/%\s*3/.test(response) && /%\s*5/.test(response)))
      );
    },
  },
  {
    id: 'fibonacci',
    prompt:
      'Write a JavaScript function called fibonacci(n) that returns the nth Fibonacci number (0-indexed, so fibonacci(0)=0, fibonacci(1)=1). ' +
      'Return only the function definition.',
    check(response) {
      return (
        /fibonacci/i.test(response) &&
        (
          /fibonacci\s*\(\s*n\s*-\s*1\s*\)/.test(response) ||
          /\[\s*0\s*,\s*1\s*\]/.test(response) ||
          /memo/.test(response) ||
          /dp\s*\[/.test(response) ||
          /fib\s*\[/.test(response) ||
          /while\s*\(/.test(response)
        )
      );
    },
  },
  {
    id: 'palindrome',
    prompt:
      'Write a JavaScript function called isPalindrome(s) that returns true if the string is a palindrome, ' +
      'ignoring case and non-alphanumeric characters. Return only the function definition.',
    check(response) {
      return (
        /isPalindrome/i.test(response) &&
        /replace/.test(response) &&
        (/toLowerCase|toUpperCase/.test(response)) &&
        (/reverse/.test(response) || /\[i\].*\[j\]/.test(response) || /split/.test(response))
      );
    },
  },
  {
    id: 'list-reverse',
    prompt:
      'Write a JavaScript function called reverseArray(arr) that returns a new reversed array without mutating the original. ' +
      'Return only the function definition.',
    check(response) {
      return (
        /reverseArray/i.test(response) &&
        (
          /\.\.\.\s*arr/.test(response) ||
          /\.slice\(\)/.test(response) ||
          /Array\.from/.test(response) ||
          /\[\.\.\./.test(response)
        ) &&
        /reverse\(\)/.test(response)
      );
    },
  },
  {
    id: 'word-count',
    prompt:
      'Write a JavaScript function called wordCount(str) that returns the number of whitespace-separated words in the string. ' +
      'Empty string should return 0. Return only the function definition.',
    check(response) {
      return (
        /wordCount/i.test(response) &&
        (
          /split\s*\(/.test(response) ||
          /\btrim\b/.test(response)
        ) &&
        /filter|length|match/.test(response)
      );
    },
  },
  {
    id: 'dedup',
    prompt:
      'Write a JavaScript function called deduplicate(arr) that returns a new array with duplicate values removed, ' +
      'preserving the original order. Return only the function definition.',
    check(response) {
      return (
        /deduplicate/i.test(response) &&
        (
          /new Set/.test(response) ||
          /indexOf/.test(response) ||
          /includes/.test(response) ||
          /filter/.test(response)
        )
      );
    },
  },
  {
    id: 'prime',
    prompt:
      'Write a JavaScript function called isPrime(n) that returns true if n is a prime number. ' +
      'Handle the edge case where n < 2 (return false). Return only the function definition.',
    check(response) {
      return (
        /isPrime/i.test(response) &&
        (/n\s*<\s*2/.test(response) || /n\s*<=\s*1/.test(response)) &&
        (/Math\.sqrt|i\s*\*\s*i/.test(response) || /for\s*\(/.test(response))
      );
    },
  },
  {
    id: 'caesar',
    prompt:
      'Write a JavaScript function called caesarCipher(str, shift) that applies a Caesar cipher to the string, ' +
      'shifting only alphabetic characters (preserving case) and leaving non-letters unchanged. ' +
      'Return only the function definition.',
    check(response) {
      return (
        /caesarCipher/i.test(response) &&
        (/charCodeAt/.test(response) || /fromCharCode/.test(response)) &&
        (/65|97/.test(response) || /a-z|A-Z/.test(response)) &&
        /26/.test(response)
      );
    },
  },
  {
    id: 'flatten',
    prompt:
      'Write a JavaScript function called flattenArray(arr) that recursively flattens a nested array to any depth. ' +
      'Return only the function definition.',
    check(response) {
      return (
        /flattenArray/i.test(response) &&
        (
          /flat\s*\(\s*Infinity/.test(response) ||
          /reduce/.test(response) ||
          /Array\.isArray/.test(response) ||
          /flattenArray\s*\(/.test(response)
        )
      );
    },
  },
  {
    id: 'binary-search',
    prompt:
      'Write a JavaScript function called binarySearch(sortedArr, target) that searches for target in a sorted array ' +
      'and returns its index, or -1 if not found. Return only the function definition.',
    check(response) {
      return (
        /binarySearch/i.test(response) &&
        /left|low|start/.test(response) &&
        /right|high|end/.test(response) &&
        /Math\.floor|>>/.test(response) &&
        /-1/.test(response)
      );
    },
  },
  {
    id: 'anagram',
    prompt:
      'Write a JavaScript function called isAnagram(a, b) that returns true if strings a and b are anagrams of each other, ' +
      'case-insensitive. Return only the function definition.',
    check(response) {
      return (
        /isAnagram/i.test(response) &&
        /toLowerCase/.test(response) &&
        (
          /sort/.test(response) ||
          /split/.test(response) ||
          /Map|map/.test(response)
        )
      );
    },
  },
  {
    id: 'count-vowels',
    prompt:
      'Write a JavaScript function called countVowels(str) that counts the number of vowels (a, e, i, o, u, case-insensitive) in the string. ' +
      'Return only the function definition.',
    check(response) {
      return (
        /countVowels/i.test(response) &&
        /[aeiou]/i.test(response) &&
        (
          /match/.test(response) ||
          /filter/.test(response) ||
          /for/.test(response) ||
          /reduce/.test(response)
        )
      );
    },
  },
  {
    id: 'merge-sorted',
    prompt:
      'Write a JavaScript function called mergeSorted(a, b) that merges two sorted arrays into a single sorted array. ' +
      'Return only the function definition.',
    check(response) {
      return (
        /mergeSorted/i.test(response) &&
        (
          /while\s*\(/.test(response) ||
          /concat.*sort/.test(response)
        ) &&
        (/result|merged|out/.test(response))
      );
    },
  },
  {
    id: 'find-duplicates',
    prompt:
      'Write a JavaScript function called findDuplicates(arr) that returns an array of values that appear more than once. ' +
      'Each duplicate value should appear only once in the result. Return only the function definition.',
    check(response) {
      return (
        /findDuplicates/i.test(response) &&
        (
          /Map|map|Set|set|{}/.test(response) ||
          /indexOf|lastIndexOf/.test(response)
        ) &&
        /filter/.test(response)
      );
    },
  },
  {
    id: 'roman-numeral',
    prompt:
      'Write a JavaScript function called toRoman(num) that converts an integer between 1 and 3999 to a Roman numeral string. ' +
      'Return only the function definition.',
    check(response) {
      return (
        /toRoman/i.test(response) &&
        /M|CM|CD|XL|IX/.test(response) &&
        (
          /while\s*\(/.test(response) ||
          /for\s*\(/.test(response) ||
          /reduce/.test(response)
        ) &&
        /result|roman|str/.test(response)
      );
    },
  },
];
