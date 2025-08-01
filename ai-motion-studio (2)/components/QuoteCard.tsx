
import React, { useState, useEffect } from 'react';

const quotes = [
  { quote: "Design is not just what it looks like and feels like. Design is how it works.", author: "Steve Jobs" },
  { quote: "The details are not the details. They make the design.", author: "Charles Eames" },
  { quote: "Good design is obvious. Great design is transparent.", author: "Joe Sparano" },
  { quote: "Creativity is intelligence having fun.", author: "Albert Einstein" },
  { quote: "Motion, in its purest form, is a type of storytelling.", author: "Anonymous" },
  { quote: "Animation can explain whatever the mind of man can conceive.", author: "Walt Disney" },
];

export const QuoteCard: React.FC = () => {
  const [quote, setQuote] = useState(quotes[0]);

  useEffect(() => {
    // Select a random quote on component mount
    setQuote(quotes[Math.floor(Math.random() * quotes.length)]);
  }, []);

  return (
    <div className="mt-8 w-full max-w-lg bg-gray-900/30 p-4 rounded-xl border border-gray-700/50"
      style={{
        animation: 'fadeIn 1s ease-in-out'
      }}
    >
      <blockquote className="text-center text-gray-400 italic">
        "{quote.quote}"
      </blockquote>
      <p className="text-right text-gray-500 text-sm mt-2">- {quote.author}</p>
    </div>
  );
};
